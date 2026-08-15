import type { Agent, Conversation, Entry, UserMessage, Workspace } from "./types";

/** A conversation record plus the time of its last entry, which is what the lists order by. */
export interface ConversationSummary extends Conversation {
	lastActivityAt: string;
}

export interface AgentOSApi {
	listWorkspaces(): Promise<Workspace[]>;
	createWorkspace(name: string): Promise<Workspace>;
	listConversations(workspaceId: string): Promise<ConversationSummary[]>;
	readConversation(workspaceId: string, conversationId: string): Promise<Entry[]>;
	startConversation(workspaceId: string, content: string): Promise<{ conversation: Conversation; message: UserMessage }>;
	sendMessage(workspaceId: string, conversationId: string, content: string): Promise<UserMessage>;
	archiveConversation(workspaceId: string, conversationId: string): Promise<Conversation>;
	listAgents(workspaceId: string): Promise<Agent[]>;
	createAgent(workspaceId: string, draft: Pick<Agent, "name" | "model" | "systemPrompt">): Promise<Agent>;
	updateAgent(workspaceId: string, agent: Agent): Promise<Agent>;
}
