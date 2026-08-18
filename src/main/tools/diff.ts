import { git } from "../git/git";
import { loadWorkspace } from "../storage/workspaceStore";
import { resolveInSandbox } from "./sandbox";
import type { SandboxDiff } from "../../shared/api";

/** What a mount has changed since its last commit, which is the question a header click asks. */
export async function sandboxDiff(
	root: string,
	workspaceId: string,
	conversationId: string,
	path: string,
): Promise<SandboxDiff> {
	const workspace = await loadWorkspace(root, workspaceId);
	const conversation = workspace.conversations.find((candidate) => candidate.id === conversationId);
	if (conversation?.sandbox === undefined) throw new Error("This conversation has no sandbox yet");

	const directory = resolveInSandbox(conversation.sandbox, path);
	const diff = await git(["diff", "HEAD"], directory);
	const listed = await git(["ls-files", "--others", "--exclude-standard", "-z"], directory);

	return { path, diff, untracked: listed.split("\0").filter((name) => name.length > 0) };
}
