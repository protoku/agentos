import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invokeTool } from "./invoke";
import { startConversation } from "../storage/conversations";
import { listScriptTools } from "../storage/scriptTools";
import { createWorkspace } from "../storage/workspaceStore";
import type { ToolCall } from "../../shared/types";

let root: string;
let workspaceId: string;
let conversationId: string;

const object = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) => ({
	type: "object",
	properties,
	required,
});

function invoke(toolId: string, input: Record<string, unknown>): Promise<ToolCall> {
	return invokeTool(root, workspaceId, conversationId, toolId, input, () => {});
}

const shout = {
	name: "shout",
	description: "Shout a word back.",
	code: "return { said: input.word.toUpperCase() };",
	env: [],
	inputSchema: object({ word: { type: "string" } }),
	outputSchema: object({ said: { type: "string" } }),
};

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agentos-"));
	workspaceId = (await createWorkspace(root, "Acme API")).id;
	conversationId = (await startConversation(root, workspaceId, "Building tools")).conversation.id;
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("define_tool", () => {
	it("adds a tool the workspace can then call", async () => {
		const call = await invoke("define_tool", shout);

		expect(call).toMatchObject({ status: "success", output: { name: "shout" } });
		expect(await invoke("shout", { word: "ship" })).toMatchObject({ output: { said: "SHIP" } });
	});

	it("is held to the same naming rules as the pane", async () => {
		await invoke("define_tool", shout);

		expect(await invoke("define_tool", shout)).toMatchObject({ error: "A tool named shout already exists" });
		expect(await invoke("define_tool", { ...shout, name: "read_file" })).toMatchObject({
			error: "read_file is a built-in tool",
		});
	});
});

describe("update_tool", () => {
	it("changes only what it was given", async () => {
		await invoke("define_tool", shout);

		const call = await invoke("update_tool", { name: "shout", code: "return { said: 'quiet' };" });

		expect(call.status).toBe("success");
		expect(await invoke("shout", { word: "ship" })).toMatchObject({ output: { said: "quiet" } });

		const [tool] = await listScriptTools(root, workspaceId);
		expect(tool.description).toBe(shout.description);
	});

	it("renames when asked, keeping the id it had", async () => {
		const created = await invoke("define_tool", shout);

		await invoke("update_tool", { name: "shout", rename: "holler" });

		const [tool] = await listScriptTools(root, workspaceId);
		expect(tool).toMatchObject({ id: created.output?.id, name: "holler" });
	});

	it("refuses a tool that is not there", async () => {
		expect(await invoke("update_tool", { name: "nothing", code: "return {};" })).toMatchObject({
			error: "No tool nothing",
		});
	});
});

describe("run_command", () => {
	it("runs in the sandbox and returns what was said", async () => {
		const call = await invoke("run_command", { command: "pwd", args: [] });

		expect(call).toMatchObject({ status: "success", output: { ok: true, exitCode: 0 } });
		expect(String(call.output?.output).trim()).toBe(
			join(root, "workspaces", workspaceId, "sandboxes", conversationId),
		);
	});

	it("reports a command that failed, rather than throwing", async () => {
		const call = await invoke("run_command", { command: "ls", args: ["nothing-here"] });

		expect(call.status).toBe("success");
		expect(call.output).toMatchObject({ ok: false });
	});

	it("says so when the command does not exist", async () => {
		const call = await invoke("run_command", { command: "definitely-not-a-command", args: [] });

		expect(call.output).toMatchObject({ ok: false, exitCode: -1 });
	});

	it("passes arguments as they are, never as a line to be split", async () => {
		const call = await invoke("run_command", { command: "echo", args: ["one two; rm -rf /"] });

		expect(String(call.output?.output).trim()).toBe("one two; rm -rf /");
	});
});
