import { git } from "../git/git";
import { currentBranch } from "../git/worktree";
import { loadWorkspace } from "../storage/workspaceStore";
import { resolveInSandbox } from "./sandbox";
import type { MountState } from "../../shared/api";

/** What a conversation is standing on right now, which for a git mount moves as it works. */
export async function mountStates(
	root: string,
	workspaceId: string,
	conversationId: string,
): Promise<MountState[]> {
	const workspace = await loadWorkspace(root, workspaceId);
	const conversation = workspace.conversations.find((candidate) => candidate.id === conversationId);
	if (conversation === undefined || conversation.sandbox === undefined) return [];

	return Promise.all(
		conversation.mounts.map(async (mount) => {
			const source = workspace.sources.find((candidate) => candidate.id === mount.sourceId);
			const state: MountState = {
				path: mount.path,
				source: source?.name ?? "unknown",
				readOnly: mount.readOnly,
			};
			if (source?.type !== "git" || conversation.sandbox === undefined) return state;

			const directory = resolveInSandbox(conversation.sandbox, mount.path);
			const branch = await currentBranch(directory).catch(() => undefined);
			const commit = await git(["rev-parse", "--short", "HEAD"], directory).then(
				(written) => written.trim(),
				() => undefined,
			);

			return { ...state, ...(branch !== undefined && { branch }), ...(commit !== undefined && { commit }) };
		}),
	);
}
