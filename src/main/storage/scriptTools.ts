import { randomUUID } from "node:crypto";
import { loadWorkspace, saveWorkspace } from "./workspaceStore";
import { builtinTools } from "../tools/builtin";
import type { ScriptTool } from "../../shared/types";

export type ScriptToolDraft = Pick<
	ScriptTool,
	"name" | "description" | "code" | "env" | "inputSchema" | "outputSchema"
>;

export async function listScriptTools(root: string, workspaceId: string): Promise<ScriptTool[]> {
	return (await loadWorkspace(root, workspaceId)).tools;
}

export async function createScriptTool(
	root: string,
	workspaceId: string,
	draft: ScriptToolDraft,
): Promise<ScriptTool> {
	const workspace = await loadWorkspace(root, workspaceId);
	refuseName(draft.name, workspace.tools);

	const tool: ScriptTool = { type: "script", id: randomUUID(), createdAt: new Date().toISOString(), ...draft };
	workspace.tools.push(tool);
	await saveWorkspace(root, workspace);

	return tool;
}

/** Edited in place: its id keeps permissions and past calls pointing at this tool. */
export async function updateScriptTool(root: string, workspaceId: string, tool: ScriptTool): Promise<ScriptTool> {
	const workspace = await loadWorkspace(root, workspaceId);
	const index = workspace.tools.findIndex((candidate) => candidate.id === tool.id);
	if (index === -1) throw new Error(`No tool ${tool.id}`);

	refuseName(
		tool.name,
		workspace.tools.filter((candidate) => candidate.id !== tool.id),
	);

	workspace.tools[index] = tool;
	await saveWorkspace(root, workspace);

	return tool;
}

/** Naming a tool is how it is called, so one name means one tool in the workspace. */
function refuseName(name: string, others: ScriptTool[]): void {
	if (!/^\w+$/.test(name)) throw new Error(`${name} is not a tool name: use letters, digits and underscores`);
	if (builtinTools.some((builtin) => builtin.name === name)) throw new Error(`${name} is a built-in tool`);
	if (others.some((tool) => tool.name === name)) throw new Error(`A tool named ${name} already exists`);
}
