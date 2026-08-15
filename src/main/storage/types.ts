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
