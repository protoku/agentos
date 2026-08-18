import type { Agent, Entry } from "./types";

/** Every agent sees the whole thread, so a turn's prompt is the thread rendered as text. */
export function transcript(entries: Entry[], agents: Agent[], acting: Agent): string {
	return [
		`You are the agent @${acting.name} in a conversation with a user and possibly other agents.`,
		"Below is everything said and done in it so far. Reply as yourself, in plain text.",
		"",
		...threadLines(entries, agents),
	].join("\n");
}

/**
 * What the conversation costs an agent, measured on the very text a turn sends.
 * Four characters a token is a rule of thumb: the exact count belongs to the model's
 * tokenizer, and one thread can go to agents on different models, so this is approximate.
 */
export function tokens(entries: Entry[], agents: Agent[]): number {
	return Math.round(threadLines(entries, agents).join("\n").length / 4);
}

function threadLines(entries: Entry[], agents: Agent[]): string[] {
	const lines = [];

	for (const entry of entries) {
		switch (entry.type) {
			case "userMessage":
				lines.push(`user: ${entry.content}`);
				break;
			case "agentMessage":
				lines.push(`@${name(agents, entry.agentId)}: ${entry.content}`);
				break;
			case "toolCall":
				lines.push(
					`${entry.agentId === undefined ? "user" : `@${name(agents, entry.agentId)}`} ran ${entry.toolId} ` +
						`(${entry.status}) with ${JSON.stringify(entry.input)}` +
						(entry.output ? ` and got ${JSON.stringify(entry.output)}` : "") +
						(entry.error ? ` and it failed: ${entry.error}` : ""),
				);
				break;
		}
	}

	return lines;
}

function name(agents: Agent[], agentId: string): string {
	return agents.find((agent) => agent.id === agentId)?.name ?? "unknown";
}
