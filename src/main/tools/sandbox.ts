import { mkdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { loadWorkspace, saveWorkspace } from "../storage/workspaceStore";

/** The conversation's own directory, created the first time a tool or a mount needs it. */
export async function ensureSandbox(root: string, workspaceId: string, conversationId: string): Promise<string> {
	const workspace = await loadWorkspace(root, workspaceId);
	const conversation = workspace.conversations.find((candidate) => candidate.id === conversationId);
	if (conversation === undefined) throw new Error(`No conversation ${conversationId}`);

	const sandbox = join(root, "workspaces", workspaceId, "sandboxes", conversationId);
	await mkdir(sandbox, { recursive: true });

	if (conversation.sandbox !== sandbox) {
		conversation.sandbox = sandbox;
		await saveWorkspace(root, workspace);
	}

	return sandbox;
}

/** Built-in tools enforce confinement: every path they touch resolves inside the sandbox. */
export function resolveInSandbox(sandbox: string, path: string): string {
	const resolved = resolve(sandbox, path);
	if (resolved !== sandbox && !resolved.startsWith(sandbox + sep)) {
		throw new Error(`Path leaves the sandbox: ${path}`);
	}

	return resolved;
}
