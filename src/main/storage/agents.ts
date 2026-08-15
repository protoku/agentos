import { randomUUID } from "node:crypto";
import { loadWorkspace, saveWorkspace } from "./workspaceStore";
import type { Agent } from "../../shared/types";

export async function listAgents(root: string, workspaceId: string): Promise<Agent[]> {
	return (await loadWorkspace(root, workspaceId)).agents;
}

export async function createAgent(
	root: string,
	workspaceId: string,
	draft: Pick<Agent, "name" | "model" | "systemPrompt">,
): Promise<Agent> {
	const workspace = await loadWorkspace(root, workspaceId);
	const agent: Agent = {
		id: randomUUID(),
		name: draft.name,
		createdAt: new Date().toISOString(),
		model: draft.model,
		systemPrompt: draft.systemPrompt,
		tools: {},
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

	workspace.agents[index] = agent;
	await saveWorkspace(root, workspace);

	return agent;
}
