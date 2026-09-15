import { readEntries } from "./conversationFile";
import { conversationFile, loadWorkspace } from "./workspaceStore";
import type { TurnUsage } from "../../shared/api";
import type { Entry, TurnEnd, TurnStart } from "../../shared/types";

/**
 * Every turn of the workspace that cost something, flattened for counting. A turn's cost lives in
 * its thread and nowhere else, so this reads them all, as listing the conversations already does.
 */
export async function readUsage(root: string, workspaceId: string): Promise<TurnUsage[]> {
	const workspace = await loadWorkspace(root, workspaceId);

	const perConversation = await Promise.all(
		workspace.conversations.map(async (conversation) => {
			const entries = await readEntries(conversationFile(root, workspaceId, conversation.id));
			// Who took a turn is on its start, so the end is joined back to it by the turn's id.
			const actors = new Map(starts(entries).map((start) => [start.id, start.agentId]));

			return ends(entries).map((end) => ({
				conversationId: conversation.id,
				title: conversation.title,
				createdAt: end.createdAt,
				spent: end.spent,
				...(actors.get(end.turnId) !== undefined && { agentId: actors.get(end.turnId) }),
				...(end.model !== undefined && { model: end.model }),
			}));
		}),
	);

	return perConversation.flat();
}

function starts(entries: Entry[]): TurnStart[] {
	return entries.filter((entry): entry is TurnStart => entry.type === "turnStart");
}

/** A turn that recorded nothing spent nothing anyone can name, so it is not counted as free. */
function ends(entries: Entry[]): (TurnEnd & { spent: NonNullable<TurnEnd["spent"]> })[] {
	return entries.filter(
		(entry): entry is TurnEnd & { spent: NonNullable<TurnEnd["spent"]> } =>
			entry.type === "turnEnd" && entry.spent !== undefined,
	);
}
