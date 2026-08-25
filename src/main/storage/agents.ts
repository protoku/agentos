import { randomUUID } from "node:crypto";
import { loadWorkspace, saveWorkspace } from "./workspaceStore";
import type { Agent } from "../../shared/types";

export type AgentDraft = Pick<Agent, "name" | "model" | "systemPrompt" | "tools" | "carries">;

export async function listAgents(root: string, workspaceId: string): Promise<Agent[]> {
	return (await loadWorkspace(root, workspaceId)).agents;
}

export async function createAgent(root: string, workspaceId: string, draft: AgentDraft): Promise<Agent> {
	const workspace = await loadWorkspace(root, workspaceId);
	refuseName(draft.name, workspace.agents);

	const agent: Agent = {
		id: randomUUID(),
		name: draft.name,
		createdAt: new Date().toISOString(),
		model: draft.model,
		systemPrompt: draft.systemPrompt,
		tools: draft.tools,
		carries: draft.carries,
	};

	workspace.agents.push(agent);
	await saveWorkspace(root, workspace);

	return agent;
}

/** Edited in place: an agent has no version history, and its id keeps mentions pointing at it. */
export async function updateAgent(root: string, workspaceId: string, agent: Agent): Promise<Agent> {
	const workspace = await loadWorkspace(root, workspaceId);
	const index = workspace.agents.findIndex((candidate) => candidate.id === agent.id);
	if (index === -1) throw new Error(`No agent ${agent.id}`);

	refuseName(
		agent.name,
		workspace.agents.filter((candidate) => candidate.id !== agent.id),
	);

	workspace.agents[index] = agent;
	await saveWorkspace(root, workspace);

	return agent;
}

/** A mention resolves by name, so one name means one agent in the workspace. */
function refuseName(name: string, others: Agent[]): void {
	const taken = others.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
	if (taken !== undefined) throw new Error(`An agent named ${taken.name} already exists`);
}
