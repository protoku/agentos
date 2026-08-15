import type { Conversation, Workspace } from "./types";

/** A conversation record plus the time of its last entry, which is what the lists order by. */
export interface ConversationSummary extends Conversation {
	lastActivityAt: string;
}

export interface AgentOSApi {
	listWorkspaces(): Promise<Workspace[]>;
	createWorkspace(name: string): Promise<Workspace>;
}
