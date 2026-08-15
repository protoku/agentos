import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgent, listAgents, updateAgent } from "./agents";
import { createWorkspace } from "./workspaceStore";

let root: string;
let workspaceId: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agentos-"));
	workspaceId = (await createWorkspace(root, "Acme API")).id;
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const draft = { name: "Ops", model: "claude-opus-5", systemPrompt: "You keep the pipeline healthy." };

describe("createAgent", () => {
	it("records the agent with no tools allowed yet", async () => {
		const agent = await createAgent(root, workspaceId, draft);

		expect(agent).toMatchObject({ ...draft, tools: {} });
		expect(await listAgents(root, workspaceId)).toEqual([agent]);
	});
});

describe("updateAgent", () => {
	it("edits in place, keeping the id and createdAt", async () => {
		const agent = await createAgent(root, workspaceId, draft);

		const edited = await updateAgent(root, workspaceId, {
			...agent,
			name: "Operations",
			model: "claude-sonnet-5",
			systemPrompt: "You watch deploys.",
		});

		expect(edited.id).toBe(agent.id);
		expect(edited.createdAt).toBe(agent.createdAt);
		expect(await listAgents(root, workspaceId)).toEqual([edited]);
	});

	it("refuses an agent the workspace does not have", async () => {
		const agent = await createAgent(root, workspaceId, draft);

		await expect(updateAgent(root, workspaceId, { ...agent, id: "nope" })).rejects.toThrow("No agent nope");
	});
});

describe("listAgents", () => {
	it("returns nothing for a workspace without agents", async () => {
		expect(await listAgents(root, workspaceId)).toEqual([]);
	});
});
