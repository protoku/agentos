import { stat } from "node:fs/promises";
import { join } from "node:path";
import { git, gitReading } from "../git/git";
import { loadWorkspace } from "../storage/workspaceStore";
import { resolveInSandbox } from "./sandbox";
import type { SandboxDiff } from "../../shared/api";

/** Big enough for a source file, small enough that a stray dump never fills the pane. */
const readable = 256 * 1024;

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
	const listed = await git(["ls-files", "--others", "--exclude-standard", "-z"], directory);
	const untracked = listed.split("\0").filter((name) => name.length > 0);

	const tracked = await git(["diff", "HEAD"], directory);
	const added = await Promise.all(untracked.map((name) => addition(directory, name)));

	return { path, diff: [tracked, ...added].filter((part) => part.length > 0).join(""), untracked };
}

/**
 * A file git has never seen is invisible to a diff, so it is diffed against nothing, which is
 * every line added. Reading it costs nothing it can undo: the index is never touched.
 */
async function addition(directory: string, name: string): Promise<string> {
	const found = await stat(join(directory, name)).catch(() => undefined);
	if (found === undefined || found.size > readable) return "";

	return gitReading(["diff", "--no-index", "--", "/dev/null", name], directory);
}
