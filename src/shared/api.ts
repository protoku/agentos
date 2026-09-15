import type {
	Agent,
	BuiltinTool,
	Conversation,
	Entry,
	Memory,
	MountSource,
	Workflow,
	ScriptTool,
	ToolCall,
	UserMessage,
	Workspace,
} from "./types";

export type ScriptToolDraft = Pick<
	ScriptTool,
	"name" | "description" | "code" | "env" | "inputSchema" | "outputSchema"
>;

/** What the pane writes: the user is not an agent, so nothing records one. */
export type MemoryDraft = Pick<Memory, "title" | "body" | "tags">;

/** A conversation record plus the time of its last entry, which is what the lists order by. */
export interface ConversationSummary extends Conversation {
	lastActivityAt: string;
}

/** A workflow as the pane edits it: what it is called, what it is for, and how it is written. */
export type WorkflowDraft = Pick<Workflow, "name" | "description" | "definition">;

/** What the viewer found at a path, which is never something it can change. */
export type SandboxView =
	| { kind: "text"; path: string; content: string; truncated: boolean }
	| { kind: "directory"; path: string; entries: SandboxEntry[] }
	| { kind: "binary"; path: string; bytes: number }
	| { kind: "missing"; path: string };

/** One name in a directory, and whether opening it leads further in. */
export interface SandboxEntry {
	name: string;
	directory: boolean;
}

/** A mount as it stands now: a git one carries the branch and commit it currently sits on. */
export interface MountState {
	path: string;
	source: string;
	readOnly: boolean;
	branch?: string;
	commit?: string;
}

/** A mount's changes: the diff against its last commit, and the files that diff cannot see. */
export interface SandboxDiff {
	path: string;
	diff: string;
	untracked: string[];
}

export interface AgentOSApi {
	/** Whether the machine's Claude Code was found, and what to say when it was not. */
	agentRuntime(): Promise<{ found: boolean; missing: string }>;
	listWorkspaces(): Promise<Workspace[]>;
	createWorkspace(name: string): Promise<Workspace>;
	deleteWorkspace(workspaceId: string): Promise<void>;
	listConversations(workspaceId: string): Promise<ConversationSummary[]>;
	readConversation(workspaceId: string, conversationId: string): Promise<Entry[]>;
	startConversation(workspaceId: string, content: string): Promise<{ conversation: Conversation; message: UserMessage }>;
	/** The other way a draft becomes real: its first entry is the tool call typed in the composer. */
	startConversationWithTool(
		workspaceId: string,
		content: string,
	): Promise<{ conversation: Conversation; call: ToolCall }>;
	sendMessage(workspaceId: string, conversationId: string, content: string): Promise<UserMessage>;
	renameConversation(workspaceId: string, conversationId: string, title: string): Promise<Conversation>;
	archiveConversation(workspaceId: string, conversationId: string): Promise<Conversation>;
	/** Shows the conversation's sandbox in the file manager. */
	openSandbox(workspaceId: string, conversationId: string): Promise<void>;
	viewSandboxPath(workspaceId: string, conversationId: string, path: string): Promise<SandboxView>;
	mountStates(workspaceId: string, conversationId: string): Promise<MountState[]>;
	sandboxDiff(workspaceId: string, conversationId: string, path: string): Promise<SandboxDiff>;
	listAgents(workspaceId: string): Promise<Agent[]>;
	createAgent(workspaceId: string, draft: Pick<Agent, "name" | "model" | "systemPrompt" | "tools" | "carries">): Promise<Agent>;
	updateAgent(workspaceId: string, agent: Agent): Promise<Agent>;
	readEnv(workspaceId: string): Promise<Record<string, string>>;
	/** Sets a key, or drops it when given no value. */
	setEnv(workspaceId: string, key: string, value?: string): Promise<Record<string, string>>;
	listMemories(workspaceId: string): Promise<Memory[]>;
	createMemory(workspaceId: string, draft: MemoryDraft): Promise<Memory>;
	updateMemory(workspaceId: string, memory: Memory): Promise<Memory>;
	deleteMemory(workspaceId: string, memoryId: string): Promise<Memory>;
	listSources(workspaceId: string): Promise<MountSource[]>;
	createSource(
		workspaceId: string,
		draft: Pick<MountSource, "name" | "type" | "config" | "description">,
	): Promise<MountSource>;
	updateSource(workspaceId: string, sourceId: string, description: string): Promise<MountSource>;
	deleteSource(workspaceId: string, sourceId: string): Promise<MountSource>;
	listTools(): Promise<BuiltinTool[]>;
	listWorkflows(workspaceId: string): Promise<Workflow[]>;
	/** Starts a run in this conversation, which then holds the thread until it ends. */
	startWorkflow(
		workspaceId: string,
		conversationId: string,
		name: string,
		input: Record<string, unknown>,
	): Promise<void>;
	/** The same from a draft, where the run is what creates the conversation. */
	startConversationWithWorkflow(
		workspaceId: string,
		content: string,
		name: string,
		input: Record<string, unknown>,
	): Promise<Conversation>;
	createWorkflow(workspaceId: string, draft: WorkflowDraft): Promise<Workflow>;
	updateWorkflow(workspaceId: string, workflow: Workflow): Promise<Workflow>;
	deleteWorkflow(workspaceId: string, workflowId: string): Promise<Workflow>;
	listScriptTools(workspaceId: string): Promise<ScriptTool[]>;
	createScriptTool(workspaceId: string, draft: ScriptToolDraft): Promise<ScriptTool>;
	updateScriptTool(workspaceId: string, tool: ScriptTool): Promise<ScriptTool>;
	deleteScriptTool(workspaceId: string, toolId: string): Promise<ScriptTool>;
	/** Rules on a pending call, which is what an ask tool waits for. */
	decideToolCall(callId: string, decision: { allowed: boolean; denyMessage?: string }): Promise<void>;
	/** Answers a pending call on ask_user, which is what that call was waiting for. */
	answerToolCall(callId: string, answers: Record<string, unknown>): Promise<void>;
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
