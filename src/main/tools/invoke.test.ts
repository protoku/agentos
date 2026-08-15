import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invokeTool, isCallRunning } from "./invoke";
import { cancelRuling } from "../turns/decisions";
import { readConversation, startConversation } from "../storage/conversations";
import { createWorkspace, loadWorkspace } from "../storage/workspaceStore";
import type { EntrySink } from "../turns/run";
import type { Entry, ToolCall } from "../../shared/types";

let root: string;
let workspaceId: string;
let conversationId: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agentos-"));
	workspaceId = (await createWorkspace(root, "Acme API")).id;
	conversationId = (await startConversation(root, workspaceId, "Scratch work")).conversation.id;
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function sandboxOf(): Promise<string> {
	return loadWorkspace(root, workspaceId).then((workspace) => workspace.conversations[0].sandbox ?? "");
}

function invoke(toolId: string, input: Record<string, unknown>, emit: EntrySink = () => {}): Promise<ToolCall> {
	return invokeTool(root, workspaceId, conversationId, toolId, input, emit);
}

describe("invokeTool", () => {
	it("writes the file in the sandbox and the call in the thread", async () => {
		const call = await invoke("write_file", {
			path: "notes/todo.md",
			content: "Ship it",
		});

		expect(call).toMatchObject({ status: "success", output: { path: "notes/todo.md", bytes: 7 } });
		expect(call.agentId).toBeUndefined();
		expect(call.turnId).toBeUndefined();
		expect(await readFile(join(await sandboxOf(), "notes/todo.md"), "utf8")).toBe("Ship it");

		const entries = await readConversation(root, workspaceId, conversationId);
		expect(entries.at(-1)).toEqual(call);
	});

	it("creates the sandbox on the first call and records it on the conversation", async () => {
		expect(await sandboxOf()).toBe("");

		await invoke("list_files", {});

		expect(await sandboxOf()).toBe(join(root, "workspaces", workspaceId, "sandboxes", conversationId));
	});

	it("reads back what it wrote, and lists it", async () => {
		await invoke("write_file", { path: "a.txt", content: "hello" });

		const read = await invoke("read_file", { path: "a.txt" });
		const list = await invoke("list_files", {});

		expect(read.output).toEqual({ path: "a.txt", content: "hello" });
		expect(list.output).toEqual({ path: ".", entries: [{ name: "a.txt", type: "file" }] });
	});

	it("refuses a path that leaves the sandbox, and records the failure", async () => {
		const call = await invoke("write_file", {
			path: "../escape.txt",
			content: "nope",
		});

		expect(call.status).toBe("error");
		expect(call.error).toContain("leaves the sandbox");
		expect(call.output).toBeUndefined();
		expect((await readConversation(root, workspaceId, conversationId)).at(-1)).toEqual(call);
	});

	it("edits a file where the snippet appears once", async () => {
		await invoke("write_file", { path: "a.txt", content: "one two three" });

		const call = await invoke("edit_file", {
			path: "a.txt",
			find: "two",
			replace: "TWO",
		});

		expect(call.status).toBe("success");
		expect(await readFile(join(await sandboxOf(), "a.txt"), "utf8")).toBe("one TWO three");
	});

	it("refuses an edit whose snippet is not there exactly once", async () => {
		await invoke("write_file", { path: "a.txt", content: "one one" });

		const call = await invoke("edit_file", {
			path: "a.txt",
			find: "one",
			replace: "1",
		});

		expect(call).toMatchObject({ status: "error", error: "Snippet appears 2 times in a.txt, expected once" });
	});

	it("moves a file, and refuses to overwrite one", async () => {
		await invoke("write_file", { path: "a.txt", content: "a" });
		await invoke("write_file", { path: "taken.txt", content: "b" });

		const moved = await invoke("move_file", { from: "a.txt", to: "b/c.txt" });
		const refused = await invoke("move_file", {
			from: "b/c.txt",
			to: "taken.txt",
		});

		expect(moved.output).toEqual({ from: "a.txt", to: "b/c.txt" });
		expect(refused).toMatchObject({ status: "error", error: "taken.txt already exists" });
	});

	it("deletes a file but not a directory", async () => {
		await invoke("write_file", { path: "dir/a.txt", content: "a" });

		const deleted = await invoke("delete_file", { path: "dir/a.txt" });
		const refused = await invoke("delete_file", { path: "dir" });

		expect(deleted.output).toEqual({ path: "dir/a.txt" });
		expect(refused).toMatchObject({ status: "error", error: "dir is a directory" });
	});

	it("searches file contents and reports where each match sits", async () => {
		await invoke("write_file", { path: "a.txt", content: "alpha\nbeta" });
		await invoke("write_file", { path: "sub/b.txt", content: "beta again" });

		const call = await invoke("search_files", { pattern: "^beta" });

		expect(call.output).toEqual({
			pattern: "^beta",
			truncated: false,
			matches: [
				{ path: "a.txt", line: 2, text: "beta" },
				{ path: join("sub", "b.txt"), line: 1, text: "beta again" },
			],
		});
	});

	it("records a call whose input does not match the tool's schema as failed", async () => {
		const call = await invoke("write_file", { path: "a.txt" });

		expect(call.status).toBe("error");
		expect(call.output).toBeUndefined();
	});

	it("shows the call while it runs, and again once it is final", async () => {
		const shown: Entry[] = [];

		await invoke("list_files", {}, (entry) => shown.push(entry));

		expect(shown.map((entry) => entry.type === "toolCall" && entry.status)).toEqual(["running", "success"]);
		expect(await readConversation(root, workspaceId, conversationId)).toHaveLength(2);
	});

	it("ends canceled when the user stops it while it runs", async () => {
		const call = await invoke("list_files", {}, (entry) => {
			if (entry.type === "toolCall" && entry.status === "running") cancelRuling(entry.id);
		});

		expect(call).toMatchObject({ status: "canceled" });
		expect(call.output).toBeUndefined();
		expect(call.decidedAt).toBeUndefined();
		expect(call.completedAt).toBeDefined();
	});

	it("occupies the conversation only while it runs", async () => {
		let occupied = false;

		await invoke("list_files", {}, (entry) => {
			if (entry.type === "toolCall" && entry.status === "running") occupied = isCallRunning(conversationId);
		});

		expect(occupied).toBe(true);
		expect(isCallRunning(conversationId)).toBe(false);
	});

	it("records an unknown tool as a failed call", async () => {
		const call = await invoke("fly_to_moon", {});

		expect(call).toMatchObject({ status: "error", error: "No tool fly_to_moon" });
	});
});
