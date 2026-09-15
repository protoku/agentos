import type { Agent, Entry, Spend } from "./types";

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
	return estimateTokens(threadLines(entries.filter(settled), agents).join("\n"));
}

/** What the conversation has actually cost, added up from the turns that reported it. */
export function spentOn(entries: Entry[]): Spend {
	const reported = entries.filter(
		(entry): entry is Extract<Entry, { type: "turnEnd" }> & { spent: Spend } =>
			entry.type === "turnEnd" && entry.spent !== undefined,
	);

	const total = reported.reduce<Spend>(
		(running, entry) => ({
			sent: running.sent + entry.spent.sent,
			cached: running.cached + entry.spent.cached,
			received: running.received + entry.spent.received,
			usd: running.usd + entry.spent.usd,
		}),
		{ sent: 0, cached: 0, received: 0, usd: 0 },
	);

	// Turns recorded before AgentOS counted requests report none, and a thread of those says none.
	const counted = reported.filter((entry) => entry.spent.requests !== undefined);
	if (counted.length === 0) return total;

	return { ...total, requests: counted.reduce((sum, entry) => sum + (entry.spent.requests ?? 0), 0) };
}

/** What any text costs, by the same rule of thumb, for anything else a turn is sent. */
export function estimateTokens(text: string): number {
	return Math.round(text.length / 4);
}

/** A call still pending or running is no part of the thread a turn is built from. */
function settled(entry: Entry): boolean {
	return entry.type !== "toolCall" || (entry.status !== "pending" && entry.status !== "running");
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
			case "workflowStart":
				lines.push(`the user started the workflow ${entry.name} with ${JSON.stringify(entry.input)}`);
				break;
			// A step is where an agent reads what it was asked for, so it is written out in full.
			case "workflowStep":
				if (entry.skipped) lines.push(`step ${entry.stepId} was skipped`);
				// A step names its agent as the definition wrote it, which is a name rather than an id.
				else if (entry.agent !== undefined) {
					lines.push(`step ${entry.stepId}, @${entry.agent} is asked to: ${entry.ask ?? ""}`);
				} else lines.push(`step ${entry.stepId} runs ${entry.tool ?? ""}`);
				break;
			case "workflowEnd":
				lines.push(
					`the workflow ended as ${entry.status}` + (entry.error === undefined ? "" : `: ${entry.error}`),
				);
				break;
		}
	}

	return lines;
}

function name(agents: Agent[], agentId: string): string {
	return agents.find((agent) => agent.id === agentId)?.name ?? "unknown";
}
