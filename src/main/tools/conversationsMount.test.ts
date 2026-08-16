import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invokeTool } from "./invoke";
import { archiveConversation, startConversation } from "../storage/conversations";
import { createSource } from "../storage/sources";
import { createWorkspace, loadWorkspace } from "../storage/workspaceStore";
import type { ToolCall } from "../../shared/types";

let root: string;
let workspaceId: string;
let conversationId: string;
let earlier: string;

function invoke(toolId: string, input: Record<string, unknown>): Promise<ToolCall> {
	return invokeTool(root, workspaceId, conversationId, toolId, input, () => {});
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agentos-"));
	workspaceId = (await createWorkspace(root, "Acme API")).id;
	earlier = (await startConversation(root, workspaceId, "The deploy went out at noon")).conversation.id;
	conversationId = (await startConversation(root, workspaceId, "Asking about earlier")).conversation.id;
	await createSource(root, workspaceId, { name: "threads", type: "conversations", config: {} });
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("a conversations mount", () => {
	it("reaches every thread of the workspace, archived ones included", async () => {
		await archiveConversation(root, workspaceId, earlier);

		await invoke("mount", { source: "threads", path: "threads" });
		const listed = await invoke("list_files", { path: "threads" });
		const read = await invoke("read_file", { path: join("threads", `${earlier}.jsonl`) });

		expect(listed.output?.entries).toContainEqual({ name: `${earlier}.jsonl`, type: "file" });
		expect(String(read.output?.content)).toContain("The deploy went out at noon");
	});

	it("is shared and read-only whether or not it was asked for", async () => {
		const call = await invoke("mount", { source: "threads", path: "threads" });

		expect(call.output).toMatchObject({ mode: "shared", readOnly: true });
		expect((await loadWorkspace(root, workspaceId)).conversations[1].mounts).toMatchObject([
			{ mode: "shared", readOnly: true },
		]);
	});

	it("refuses terms it does not get to have", async () => {
		expect(await invoke("mount", { source: "threads", path: "threads", mode: "isolated" })).toMatchObject({
			error: "A conversations mount is always shared",
		});
		expect(await invoke("mount", { source: "threads", path: "threads", readOnly: false })).toMatchObject({
			error: "A conversations mount is always read-only",
		});
	});

	it("cannot be written through, since a thread is a record", async () => {
		await invoke("mount", { source: "threads", path: "threads" });

		expect(await invoke("write_file", { path: "threads/new.jsonl", content: "no" })).toMatchObject({
			error: "threads is mounted read-only",
		});
	});
});
