import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { builtinTool } from "./builtin";
import { invokeTool } from "./invoke";
import { createAgent } from "../storage/agents";
import { listMemories } from "../storage/memories";
import { startConversation } from "../storage/conversations";
import { createWorkspace } from "../storage/workspaceStore";
import type { ToolCall } from "../../shared/types";

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

function invoke(toolId: string, input: Record<string, unknown>): Promise<ToolCall> {
	return invokeTool(root, workspaceId, conversationId, toolId, input, () => {});
}

const deploys = { title: "Deploy process", body: "Blue-green through scripts/deploy.", tags: ["deploy", "ops"] };

describe("create_memory", () => {
	it("writes it down and says whose turns it just joined", async () => {
		await createAgent(root, workspaceId, {
			name: "dev",
			model: "claude-opus-5",
			systemPrompt: "",
			tools: {},
			carries: ["ops"],
		});

		const call = await invoke("create_memory", deploys);

		expect(call).toMatchObject({
			status: "success",
			output: { title: "Deploy process", tags: "deploy, ops", carriedBy: "@dev" },
		});
		expect(await listMemories(root, workspaceId)).toHaveLength(1);
	});

	it("says nobody carries it when no agent does", async () => {
		expect((await invoke("create_memory", deploys)).output).toMatchObject({ carriedBy: "nobody" });
	});

	it("records the agent that wrote it, and nobody when the user did", async () => {
		const sandbox = join(root, "sandbox");
		const context = { root, workspaceId, conversationId, sandbox, signal: new AbortController().signal };

		await builtinTool("create_memory").run(deploys, { ...context, agentId: "agent-1" });
		await builtinTool("create_memory").run({ ...deploys, title: "Staging tokens" }, context);

		const [written, typed] = await listMemories(root, workspaceId);
		expect(written?.agentId).toBe("agent-1");
		expect(typed).not.toHaveProperty("agentId");
	});

	it("refuses what the storage refuses, in words the caller reads", async () => {
		await invoke("create_memory", deploys);

		expect(await invoke("create_memory", deploys)).toMatchObject({
			status: "error",
			error: "A memory titled Deploy process already exists",
		});
	});
});

describe("search_memory", () => {
	beforeEach(async () => {
		await invoke("create_memory", deploys);
		await invoke("create_memory", { title: "Staging tokens", body: "They live in Env.", tags: ["ops"] });
	});

	it("finds by word and by tag, and counts what it found", async () => {
		expect((await invoke("search_memory", { query: "blue-green" })).output).toMatchObject({
			found: 1,
			truncated: false,
			matches: [{ title: "Deploy process", tags: "deploy, ops" }],
		});
		expect((await invoke("search_memory", { tags: ["ops"] })).output).toMatchObject({ found: 2 });
	});

	it("hands back the whole pool when asked for nothing", async () => {
		expect((await invoke("search_memory", {})).output).toMatchObject({ found: 2 });
	});

	it("returns each memory whole, with the id that names it again", async () => {
		const found = (await invoke("search_memory", { query: "env" })).output?.matches as Record<string, unknown>[];

		expect(found[0]).toMatchObject({ body: "They live in Env.", id: expect.any(String) });
	});
});

describe("update_memory", () => {
	it("changes what it is given and leaves the rest", async () => {
		const written = (await invoke("create_memory", deploys)).output;

		const call = await invoke("update_memory", { id: written?.id, body: "Blue-green, and never on Friday." });

		expect(call).toMatchObject({ status: "success", output: { title: "Deploy process", tags: "deploy, ops" } });
		expect((await listMemories(root, workspaceId))[0]?.body).toBe("Blue-green, and never on Friday.");
	});

	it("refuses an id the workspace does not know", async () => {
		expect(await invoke("update_memory", { id: "guessed", body: "Anything." })).toMatchObject({
			status: "error",
			error: "No memory guessed",
		});
	});
});

describe("delete_memory", () => {
	it("forgets it and says what went", async () => {
		const written = (await invoke("create_memory", deploys)).output;

		expect(await invoke("delete_memory", { id: written?.id })).toMatchObject({
			status: "success",
			output: { title: "Deploy process", tags: "deploy, ops" },
		});
		expect(await listMemories(root, workspaceId)).toEqual([]);
	});

	it("refuses an id the workspace does not know", async () => {
		expect(await invoke("delete_memory", { id: "guessed" })).toMatchObject({ error: "No memory guessed" });
	});
});
