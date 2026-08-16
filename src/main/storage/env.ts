import { loadWorkspace, saveWorkspace } from "./workspaceStore";

export async function readEnv(root: string, workspaceId: string): Promise<Record<string, string>> {
	return (await loadWorkspace(root, workspaceId)).env;
}

/** Set a key, or drop it by setting nothing: the env is what the workspace's tools may be given. */
export async function setEnv(
	root: string,
	workspaceId: string,
	key: string,
	value?: string,
): Promise<Record<string, string>> {
	const workspace = await loadWorkspace(root, workspaceId);

	if (value === undefined) delete workspace.env[key];
	else workspace.env[key] = value;

	await saveWorkspace(root, workspace);

	return workspace.env;
}
