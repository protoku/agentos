import type {
	Agent,
	BuiltinTool,
	Conversation,
	Entry,
	MountSource,
	ToolCall,
	UserMessage,
	Workspace,
} from "./types";

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
	/** The other way a draft becomes real: its first entry is the tool call typed in the composer. */
	startConversationWithTool(
		workspaceId: string,
		content: string,
	): Promise<{ conversation: Conversation; call: ToolCall }>;
	sendMessage(workspaceId: string, conversationId: string, content: string): Promise<UserMessage>;
	archiveConversation(workspaceId: string, conversationId: string): Promise<Conversation>;
	listAgents(workspaceId: string): Promise<Agent[]>;
	createAgent(workspaceId: string, draft: Pick<Agent, "name" | "model" | "systemPrompt" | "tools">): Promise<Agent>;
	updateAgent(workspaceId: string, agent: Agent): Promise<Agent>;
	readEnv(workspaceId: string): Promise<Record<string, string>>;
	/** Sets a key, or drops it when given no value. */
	setEnv(workspaceId: string, key: string, value?: string): Promise<Record<string, string>>;
	listSources(workspaceId: string): Promise<MountSource[]>;
	createSource(workspaceId: string, draft: Pick<MountSource, "name" | "type" | "config">): Promise<MountSource>;
	listTools(): Promise<BuiltinTool[]>;
	/** Rules on a pending call, which is what an ask tool waits for. */
	decideToolCall(callId: string, decision: { allowed: boolean; denyMessage?: string }): Promise<void>;
	/** Stops the acting agent and skips every mention after it. */
	cancelTurn(conversationId: string): Promise<void>;
	/** Stops one running call; the agent that made it hears so and carries on. */
	cancelToolCall(callId: string): Promise<void>;
	invokeTool(
		workspaceId: string,
		conversationId: string,
		toolId: string,
		input: Record<string, unknown>,
	): Promise<ToolCall>;
	/** Entries an agent adds while its turn runs. Returns the unsubscribe. */
	onThreadEntry(listener: (workspaceId: string, conversationId: string, entry: Entry) => void): () => void;
}
