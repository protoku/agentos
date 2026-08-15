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

	it("records an unknown tool as a failed call", async () => {
		const call = await invokeTool(root, workspaceId, conversationId, "fly_to_moon", {});

		expect(call).toMatchObject({ status: "error", error: "No tool fly_to_moon" });
	});
});
