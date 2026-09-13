import { randomUUID } from "node:crypto";
import { loadWorkspace, saveWorkspace } from "./workspaceStore";
import { builtinTools } from "../tools/builtin";
import { parseDefinition } from "../workflows/definition";
import type { Workflow } from "../../shared/types";

export type WorkflowDraft = Pick<Workflow, "name" | "description" | "definition">;

export async function listWorkflows(root: string, workspaceId: string): Promise<Workflow[]> {
	return (await loadWorkspace(root, workspaceId)).workflows;
}

export async function createWorkflow(root: string, workspaceId: string, draft: WorkflowDraft): Promise<Workflow> {
	const workspace = await loadWorkspace(root, workspaceId);
	refuseName(workspace.workflows, workspace.tools, draft.name);
	parseDefinition(draft.definition);

	const workflow: Workflow = { id: randomUUID(), createdAt: new Date().toISOString(), ...draft };

	workspace.workflows.push(workflow);
	await saveWorkspace(root, workspace);

	return workflow;
}

/** The id stays what it was, so a run recorded in a thread still points at this workflow. */
export async function updateWorkflow(root: string, workspaceId: string, workflow: Workflow): Promise<Workflow> {
	const workspace = await loadWorkspace(root, workspaceId);
	const current = workspace.workflows.find((candidate) => candidate.id === workflow.id);
	if (current === undefined) throw new Error(`No workflow ${workflow.id}`);

	refuseName(
		workspace.workflows.filter((candidate) => candidate.id !== workflow.id),
		workspace.tools,
		workflow.name,
	);
	parseDefinition(workflow.definition);

	Object.assign(current, workflow, { id: current.id, createdAt: current.createdAt });
	await saveWorkspace(root, workspace);

	return current;
}

/**
 * A workflow can be forgotten, which nothing else in a workspace can. One that is wrong keeps
 * offering to run, and what it did stays in the threads that ran it.
 */
export async function deleteWorkflow(root: string, workspaceId: string, workflowId: string): Promise<Workflow> {
	const workspace = await loadWorkspace(root, workspaceId);
	const workflow = workspace.workflows.find((candidate) => candidate.id === workflowId);
	if (workflow === undefined) throw new Error(`No workflow ${workflowId}`);

	workspace.workflows = workspace.workflows.filter((candidate) => candidate !== workflow);
	await saveWorkspace(root, workspace);

	return workflow;
}

/** One name means one thing to call: a workflow is invoked exactly as a tool is. */
export function refuseName(workflows: Workflow[], tools: { name: string }[], name: string): void {
	if (!/^\w+$/.test(name)) throw new Error(`${name} is not a workflow name: use letters, digits and underscores`);
	if (builtinTools.some((tool) => tool.name === name)) throw new Error(`${name} is a built-in tool`);
	if (tools.some((tool) => tool.name === name)) throw new Error(`${name} is a tool of this workspace`);
	if (workflows.some((workflow) => workflow.name === name)) {
		throw new Error(`A workflow named ${name} already exists`);
	}
}
