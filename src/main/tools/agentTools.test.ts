import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invokeTool } from "./invoke";
import { listAgents } from "../storage/agents";
import { startConversation } from "../storage/conversations";
import { createWorkspace } from "../storage/workspaceStore";
import { defaultModel } from "../../shared/models";
import type { ToolCall } from "../../shared/types";

let root: string;
let workspaceId: string;
let conversationId: string;

function invoke(toolId: string, input: Record<string, unknown> = {}): Promise<ToolCall> {
	return invokeTool(root, workspaceId, conversationId, toolId, input, () => {});
}

const ops = {
	name: "ops",
	systemPrompt: "You watch the deploys.",
	tools: { read_file: "allow", delete_file: "ask", write_file: "deny" },
	carries: ["deploy"],
};

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agentos-"));
	workspaceId = (await createWorkspace(root, "Acme API")).id;
	conversationId = (await startConversation(root, workspaceId, "Building agents")).conversation.id;
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("create_agent", () => {
	it("adds an agent the workspace can then mention", async () => {
		const call = await invoke("create_agent", ops);

		expect(call).toMatchObject({ status: "success", output: { name: "ops", tools: 2 } });

		const [agent] = await listAgents(root, workspaceId);
		expect(agent).toMatchObject({ name: "ops", model: defaultModel, carries: ["deploy"] });
	});

	it("resolves permissions by tool name, denied being the absence of one", async () => {
		await invoke("create_agent", ops);

		const [agent] = await listAgents(root, workspaceId);
		expect(agent.tools).toEqual({ read_file: "allow", delete_file: "ask" });
	});

	it("gives a script tool the id the workspace generated", async () => {
		const defined = await invoke("define_tool", {
			name: "shout",
			description: "Shout a word back.",
			code: "return { said: input.word.toUpperCase() };",
			env: [],
			inputSchema: { type: "object", properties: { word: { type: "string" } }, required: ["word"] },
			outputSchema: { type: "object", properties: { said: { type: "string" } }, required: ["said"] },
		});

		await invoke("create_agent", { ...ops, tools: { shout: "allow" } });

		const [agent] = await listAgents(root, workspaceId);
		expect(agent.tools).toEqual({ [String(defined.output?.id)]: "allow" });
	});

	it("refuses a tool, a model and a name it cannot honour", async () => {
		expect(await invoke("create_agent", { ...ops, tools: { nothing: "allow" } })).toMatchObject({
			error: "No tool nothing",
		});
		expect(await invoke("create_agent", { ...ops, model: "gpt-9" })).toMatchObject({ error: "No model gpt-9" });

		await invoke("create_agent", ops);
		expect(await invoke("create_agent", { ...ops, name: "OPS" })).toMatchObject({
			error: "An agent named ops already exists",
		});
	});
});

describe("update_agent", () => {
	it("changes only what it was given", async () => {
		await invoke("create_agent", ops);

		const call = await invoke("update_agent", { name: "ops", systemPrompt: "You watch the deploys closely." });

		expect(call.status).toBe("success");

		const [agent] = await listAgents(root, workspaceId);
		expect(agent).toMatchObject({
			systemPrompt: "You watch the deploys closely.",
			carries: ["deploy"],
			tools: { read_file: "allow", delete_file: "ask" },
		});
	});

	it("renames when asked, keeping the id mentions point at", async () => {
		const created = await invoke("create_agent", ops);

		await invoke("update_agent", { name: "ops", rename: "sre" });

		const [agent] = await listAgents(root, workspaceId);
		expect(agent).toMatchObject({ id: created.output?.id, name: "sre" });
	});

	it("replaces the whole permission list rather than merging into it", async () => {
		await invoke("create_agent", ops);

		await invoke("update_agent", { name: "ops", tools: { list_files: "allow" } });

		const [agent] = await listAgents(root, workspaceId);
		expect(agent.tools).toEqual({ list_files: "allow" });
	});

	it("refuses an agent that is not there, and a name already taken", async () => {
		await invoke("create_agent", ops);
		await invoke("create_agent", { ...ops, name: "dev" });

		expect(await invoke("update_agent", { name: "nobody", systemPrompt: "..." })).toMatchObject({
			error: "No agent nobody",
		});
		expect(await invoke("update_agent", { name: "dev", rename: "ops" })).toMatchObject({
			error: "An agent named ops already exists",
		});
	});
});

describe("read_agent and list_agents", () => {
	it("reads one whole, its permissions back under the names they were given", async () => {
		await invoke("create_agent", ops);

		const call = await invoke("read_agent", { name: "ops" });

		expect(call.output).toMatchObject({
			name: "ops",
			model: defaultModel,
			carries: "deploy",
			systemPrompt: ops.systemPrompt,
			tools: [
				{ tool: "read_file", permission: "allow" },
				{ tool: "delete_file", permission: "ask" },
			],
		});
	});

	it("lists who the workspace has", async () => {
		await invoke("create_agent", ops);
		await invoke("create_agent", { ...ops, name: "dev", carries: [] });

		const call = await invoke("list_agents");

		expect(call.output?.agents).toEqual([
			{ name: "ops", model: defaultModel, carries: "deploy", tools: 2 },
			{ name: "dev", model: defaultModel, carries: "", tools: 2 },
		]);
	});
});
