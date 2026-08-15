export interface Workspace {
	id: string;
	name: string;
	createdAt: string;
	agents: Agent[];
	tools: ScriptTool[];
	env: Record<string, string>;
	sources: MountSource[];
	conversations: Conversation[];
}

/** The record only: a conversation's entries live in its thread file, never here. */
export interface Conversation {
	id: string;
	title: string;
	createdAt: string;
	archivedAt?: string;
	sandbox?: string;
	mounts: Mount[];
}

export interface Agent {
	id: string;
	name: string;
	createdAt: string;
	model: string;
	systemPrompt: string;
	tools: Record<string, "allow" | "ask" | "deny">;
}

export interface ScriptTool {
	type: "script";
	id: string;
	name: string;
	createdAt: string;
	description: string;
	code: string;
	env: string[];
	inputSchema: Record<string, unknown>;
	outputSchema: Record<string, unknown>;
}

export interface MountSource {
	id: string;
	name: string;
	createdAt: string;
	type: "git" | "directory" | "conversations";
	config: Record<string, unknown>;
}

export interface Mount {
	sourceId: string;
	path: string;
	mode: "isolated" | "shared";
	readOnly: boolean;
	createdAt: string;
}

export type Entry = Message | ToolCall | TurnStart | TurnEnd;

export type Message = UserMessage | AgentMessage;

export interface UserMessage {
	type: "userMessage";
	id: string;
	mentions?: string[];
	content: string;
	createdAt: string;
}

export interface AgentMessage {
	type: "agentMessage";
	id: string;
	agentId: string;
	turnId: string;
	content: string;
	createdAt: string;
}

export interface ToolCall {
	type: "toolCall";
	id: string;
	agentId?: string;
	turnId?: string;
	toolId: string;
	reason?: string;
	input: Record<string, unknown>;
	output?: Record<string, unknown>;
	error?: string;
	denyMessage?: string;
	status: "pending" | "running" | "success" | "error" | "denied" | "canceled";
	createdAt: string;
	decidedAt?: string;
	completedAt?: string;
}

export interface TurnStart {
	type: "turnStart";
	id: string;
	agentId: string;
	createdAt: string;
}

export interface TurnEnd {
	type: "turnEnd";
	id: string;
	turnId: string;
	status: "finished" | "failed" | "canceled";
	error?: string;
	createdAt: string;
}
