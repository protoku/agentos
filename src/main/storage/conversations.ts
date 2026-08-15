import { randomUUID } from "node:crypto";
import { appendEntry, readEntries } from "./conversationFile";
import { conversationFile, loadWorkspace, saveWorkspace } from "./workspaceStore";
import type { ConversationSummary } from "../../shared/api";
import { findMentions } from "../../shared/mentions";
import type { Conversation, Entry, UserMessage } from "../../shared/types";

const titleLength = 60;

/** A draft becomes a conversation here: the record is written first, then its first message. */
export async function startConversation(
	root: string,
	workspaceId: string,
	content: string,
): Promise<{ conversation: Conversation; message: UserMessage }> {
	const workspace = await loadWorkspace(root, workspaceId);
	const conversation: Conversation = {
		id: randomUUID(),
		title: titleFrom(content),
		createdAt: new Date().toISOString(),
		mounts: [],
	};

	workspace.conversations.push(conversation);
	await saveWorkspace(root, workspace);
	const message = await sendMessage(root, workspaceId, conversation.id, content);

	return { conversation, message };
}

export async function sendMessage(
	root: string,
	workspaceId: string,
	conversationId: string,
	content: string,
): Promise<UserMessage> {
	const workspace = await loadWorkspace(root, workspaceId);
	const mentions = findMentions(content, workspace.agents).map((mention) => mention.agentId);

	const message: UserMessage = {
		type: "userMessage",
		id: randomUUID(),
		...(mentions.length > 0 && { mentions }),
		content,
		createdAt: new Date().toISOString(),
	};

	await appendEntry(conversationFile(root, workspaceId, conversationId), message);

	return message;
}

/** Closing a conversation for good: there is no unarchive, and the thread stays readable. */
export async function archiveConversation(
	root: string,
	workspaceId: string,
	conversationId: string,
): Promise<Conversation> {
	const workspace = await loadWorkspace(root, workspaceId);
	const conversation = workspace.conversations.find((candidate) => candidate.id === conversationId);
	if (conversation === undefined) throw new Error(`No conversation ${conversationId}`);

	conversation.archivedAt = new Date().toISOString();
	await saveWorkspace(root, workspace);

	return conversation;
}

export async function readConversation(
	root: string,
	workspaceId: string,
	conversationId: string,
): Promise<Entry[]> {
	return readEntries(conversationFile(root, workspaceId, conversationId));
}

/** Every conversation of the workspace, archived ones included, most recent activity first. */
export async function listConversations(root: string, workspaceId: string): Promise<ConversationSummary[]> {
	const workspace = await loadWorkspace(root, workspaceId);

	const summaries = await Promise.all(
		workspace.conversations.map(async (conversation) => {
			const entries = await readConversation(root, workspaceId, conversation.id);
			const last = entries.at(-1);
			return { ...conversation, lastActivityAt: last?.createdAt ?? conversation.createdAt };
		}),
	);

	return summaries.sort((a, b) => (b.lastActivityAt < a.lastActivityAt ? -1 : b.lastActivityAt > a.lastActivityAt ? 1 : 0));
}

function titleFrom(content: string): string {
	const line = content.trim().replace(/\s+/g, " ");
	if (line.length <= titleLength) return line;

	const cut = line.slice(0, titleLength);
	const lastSpace = cut.lastIndexOf(" ");

	return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
