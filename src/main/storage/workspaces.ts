import { rm } from "node:fs/promises";
import { loadWorkspace, workspaceDirectory } from "./workspaceStore";
import { whenCallSettles } from "../tools/invoke";
import { cancelRulings } from "../turns/decisions";
import { cancelTurn, whenTurnSettles } from "../turns/run";

/**
 * The one deletion in AgentOS: threads, sandboxes, clones and worktrees all live under the
 * workspace directory and go with it. Symlinked directory mounts inside sandboxes are removed
 * as links, since rm never follows them, so the directories they point at stay untouched.
 */
export async function deleteWorkspace(root: string, workspaceId: string): Promise<void> {
	// Loaded first so an id that is not there is refused instead of removing nothing quietly.
	const workspace = await loadWorkspace(root, workspaceId);

	for (const conversation of workspace.conversations) {
		cancelTurn(conversation.id);
		cancelRulings(conversation.id);
	}

	// Canceling only asks. A turn or call still writes the entry it stopped on, and that write
	// would build the workspace directory again, leaving a thread nothing can reach or remove.
	await Promise.allSettled(
		workspace.conversations.flatMap((conversation) => [
			whenTurnSettles(conversation.id),
			whenCallSettles(conversation.id),
		]),
	);

	await rm(workspaceDirectory(root, workspaceId), { recursive: true, force: true });
}
