import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invokeTool } from "./invoke";
import { readConversation, startConversation } from "../storage/conversations";
import { createWorkspace, loadWorkspace } from "../storage/workspaceStore";

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

describe("invokeTool", () => {
	it("writes the file in the sandbox and the call in the thread", async () => {
		const call = await invokeTool(root, workspaceId, conversationId, "write_file", {
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

		await invokeTool(root, workspaceId, conversationId, "list_files", {});

		expect(await sandboxOf()).toBe(join(root, "workspaces", workspaceId, "sandboxes", conversationId));
	});

	it("reads back what it wrote, and lists it", async () => {
		await invokeTool(root, workspaceId, conversationId, "write_file", { path: "a.txt", content: "hello" });

		const read = await invokeTool(root, workspaceId, conversationId, "read_file", { path: "a.txt" });
		const list = await invokeTool(root, workspaceId, conversationId, "list_files", {});

		expect(read.output).toEqual({ path: "a.txt", content: "hello" });
		expect(list.output).toEqual({ path: ".", entries: [{ name: "a.txt", type: "file" }] });
	});

	it("refuses a path that leaves the sandbox, and records the failure", async () => {
		const call = await invokeTool(root, workspaceId, conversationId, "write_file", {
			path: "../escape.txt",
			content: "nope",
		});

		expect(call.status).toBe("error");
		expect(call.error).toContain("leaves the sandbox");
		expect(call.output).toBeUndefined();
		expect((await readConversation(root, workspaceId, conversationId)).at(-1)).toEqual(call);
	});

	it("edits a file where the snippet appears once", async () => {
		await invokeTool(root, workspaceId, conversationId, "write_file", { path: "a.txt", content: "one two three" });

		const call = await invokeTool(root, workspaceId, conversationId, "edit_file", {
			path: "a.txt",
			find: "two",
			replace: "TWO",
		});

		expect(call.status).toBe("success");
		expect(await readFile(join(await sandboxOf(), "a.txt"), "utf8")).toBe("one TWO three");
	});

	it("refuses an edit whose snippet is not there exactly once", async () => {
		await invokeTool(root, workspaceId, conversationId, "write_file", { path: "a.txt", content: "one one" });

		const call = await invokeTool(root, workspaceId, conversationId, "edit_file", {
			path: "a.txt",
			find: "one",
			replace: "1",
		});

		expect(call).toMatchObject({ status: "error", error: "Snippet appears 2 times in a.txt, expected once" });
	});

	it("moves a file, and refuses to overwrite one", async () => {
		await invokeTool(root, workspaceId, conversationId, "write_file", { path: "a.txt", content: "a" });
		await invokeTool(root, workspaceId, conversationId, "write_file", { path: "taken.txt", content: "b" });

		const moved = await invokeTool(root, workspaceId, conversationId, "move_file", { from: "a.txt", to: "b/c.txt" });
		const refused = await invokeTool(root, workspaceId, conversationId, "move_file", {
			from: "b/c.txt",
			to: "taken.txt",
		});

		expect(moved.output).toEqual({ from: "a.txt", to: "b/c.txt" });
		expect(refused).toMatchObject({ status: "error", error: "taken.txt already exists" });
	});

	it("deletes a file but not a directory", async () => {
		await invokeTool(root, workspaceId, conversationId, "write_file", { path: "dir/a.txt", content: "a" });

		const deleted = await invokeTool(root, workspaceId, conversationId, "delete_file", { path: "dir/a.txt" });
		const refused = await invokeTool(root, workspaceId, conversationId, "delete_file", { path: "dir" });

		expect(deleted.output).toEqual({ path: "dir/a.txt" });
		expect(refused).toMatchObject({ status: "error", error: "dir is a directory" });
	});

	it("searches file contents and reports where each match sits", async () => {
		await invokeTool(root, workspaceId, conversationId, "write_file", { path: "a.txt", content: "alpha\nbeta" });
		await invokeTool(root, workspaceId, conversationId, "write_file", { path: "sub/b.txt", content: "beta again" });

		const call = await invokeTool(root, workspaceId, conversationId, "search_files", { pattern: "^beta" });

		expect(call.output).toEqual({
			pattern: "^beta",
			truncated: false,
			matches: [
				{ path: "a.txt", line: 2, text: "beta" },
				{ path: join("sub", "b.txt"), line: 1, text: "beta again" },
			],
		});
	});

	it("records an unknown tool as a failed call", async () => {
		const call = await invokeTool(root, workspaceId, conversationId, "fly_to_moon", {});

		expect(call).toMatchObject({ status: "error", error: "No tool fly_to_moon" });
	});
});
