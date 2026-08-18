import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invokeTool } from "./invoke";
import { startConversation } from "../storage/conversations";
import { setEnv } from "../storage/env";
import { createScriptTool } from "../storage/scriptTools";
import { createWorkspace } from "../storage/workspaceStore";
import { cancelRuling } from "../turns/decisions";
import type { ScriptToolDraft } from "../storage/scriptTools";
import type { ToolCall } from "../../shared/types";

let root: string;
let workspaceId: string;
let conversationId: string;

const object = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) => ({
	type: "object",
	properties,
	required,
});

const draft: ScriptToolDraft = {
	name: "shout",
	description: "Shout a word back.",
	code: "return { said: input.word.toUpperCase() };",
	env: [],
	inputSchema: object({ word: { type: "string" } }),
	outputSchema: object({ said: { type: "string" } }),
};

function invoke(toolId: string, input: Record<string, unknown>): Promise<ToolCall> {
	return invokeTool(root, workspaceId, conversationId, toolId, input, () => {});
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agentos-"));
	workspaceId = (await createWorkspace(root, "Acme API")).id;
	conversationId = (await startConversation(root, workspaceId, "Scratch work")).conversation.id;
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("a script tool", () => {
	it("runs by name and records the call against the tool's own id", async () => {
		const tool = await createScriptTool(root, workspaceId, draft);

		const call = await invoke("shout", { word: "ship" });

		expect(call).toMatchObject({ status: "success", toolId: tool.id, output: { said: "SHIP" } });
	});

	it("starts in the sandbox, so relative work lands there", async () => {
		await createScriptTool(root, workspaceId, {
			...draft,
			name: "here",
			code: "return { here: process.cwd() };",
			inputSchema: object({}, []),
			outputSchema: object({ here: { type: "string" } }),
		});

		const call = await invoke("here", {});

		expect(call.output?.here).toBe(join(root, "workspaces", workspaceId, "sandboxes", conversationId));
	});

	it("sees the env keys it declares, and nothing else of the workspace's", async () => {
		await setEnv(root, workspaceId, "API_TOKEN", "secret");
		await setEnv(root, workspaceId, "OTHER", "hidden");
		await createScriptTool(root, workspaceId, {
			...draft,
			name: "peek",
			code: "return { keys: Object.keys(env).sort(), token: env.API_TOKEN ?? '' };",
			env: ["API_TOKEN"],
			inputSchema: object({}, []),
			outputSchema: object({ keys: { type: "array", items: { type: "string" } }, token: { type: "string" } }),
		});

		const call = await invoke("peek", {});

		expect(call.output).toEqual({ keys: ["API_TOKEN"], token: "secret" });
	});

	it("can spawn a command, with input passed as arguments", async () => {
		await createScriptTool(root, workspaceId, {
			...draft,
			name: "echo",
			code: "const { execFileSync } = require('node:child_process'); return { said: execFileSync('echo', [input.word]).toString().trim() };",
			inputSchema: object({ word: { type: "string" } }),
			outputSchema: object({ said: { type: "string" } }),
		});

		expect((await invoke("echo", { word: "hello" })).output).toEqual({ said: "hello" });
	});

	it("refuses input that does not match its schema, before any of it runs", async () => {
		await createScriptTool(root, workspaceId, draft);

		expect(await invoke("shout", {})).toMatchObject({ status: "error" });
	});

	it("refuses output that does not match its schema, since the shape is the contract", async () => {
		await createScriptTool(root, workspaceId, {
			...draft,
			name: "wrong",
			code: "return { other: 1 };",
			inputSchema: object({}, []),
			outputSchema: object({ said: { type: "string" } }),
		});

		expect(await invoke("wrong", {})).toMatchObject({ status: "error" });
	});

	it("stops the work itself when the call is canceled, not just the waiting for it", async () => {
		await createScriptTool(root, workspaceId, {
			...draft,
			name: "slow",
			code: "const { writeFileSync } = require('node:fs'); await new Promise((wait) => setTimeout(wait, 3000)); writeFileSync('finished.txt', 'late'); return {};",
			inputSchema: object({}, []),
			outputSchema: object({}, []),
		});

		const started = Date.now();
		const call = await invokeTool(root, workspaceId, conversationId, "slow", {}, (entry) => {
			if (entry.type === "toolCall" && entry.status === "running") cancelRuling(entry.id);
		});

		expect(call.status).toBe("canceled");
		expect(Date.now() - started).toBeLessThan(2000);

		// The child was killed, so the write it would have done a moment later never happens.
		await new Promise((wait) => setTimeout(wait, 3500));
		expect(existsSync(join(root, "workspaces", workspaceId, "sandboxes", conversationId, "finished.txt"))).toBe(false);
	}, 15_000);

	it("is not handed the settings AgentOS runs itself under", async () => {
		process.env.ELECTRON_RUN_AS_NODE = "1";
		process.env.NODE_ENV = "production";

		await createScriptTool(root, workspaceId, {
			...draft,
			name: "environment",
			code: "return { node: process.env.NODE_ENV ?? 'unset', electron: process.env.ELECTRON_RUN_AS_NODE ?? 'unset' };",
			inputSchema: object({}, []),
			outputSchema: object({ node: { type: "string" }, electron: { type: "string" } }),
		});

		const call = await invoke("environment", {});

		delete process.env.ELECTRON_RUN_AS_NODE;
		delete process.env.NODE_ENV;

		// Otherwise npm inside a tool omits devDependencies, because the app happens to be packaged.
		expect(call.output).toEqual({ node: "unset", electron: "unset" });
	});

	it("records what the function threw", async () => {
		await createScriptTool(root, workspaceId, {
			...draft,
			name: "broken",
			code: "throw new Error('the remote said no');",
			inputSchema: object({}, []),
			outputSchema: object({}, []),
		});

		expect(await invoke("broken", {})).toMatchObject({ status: "error", error: "the remote said no" });
	});
});
