import type { Agent, Entry } from "../../shared/types";

/** Every agent sees the whole thread, so a turn's prompt is the thread rendered as text. */
export function transcript(entries: Entry[], agents: Agent[], acting: Agent): string {
	const lines = [
		`You are the agent @${acting.name} in a conversation with a user and possibly other agents.`,
		"Below is everything said and done in it so far. Reply as yourself, in plain text.",
		"",
	];

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

	return lines.join("\n");
}

function name(agents: Agent[], agentId: string): string {
	return agents.find((agent) => agent.id === agentId)?.name ?? "unknown";
}
