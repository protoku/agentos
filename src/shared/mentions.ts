import type { Agent } from "./types";

export interface Mention {
	agentId: string;
	start: number;
	end: number;
}

/**
 * Every @name that matches an agent, in mention order, repeats included: each one is its own turn.
 * Longest name first, so "@code review" beats an agent called "code".
 */
export function findMentions(content: string, agents: Pick<Agent, "id" | "name">[]): Mention[] {
	const byLength = [...agents].sort((a, b) => b.name.length - a.name.length);
	const lower = content.toLowerCase();
	const mentions: Mention[] = [];

	for (let index = 0; index < content.length; index++) {
		if (content[index] !== "@") continue;

		const start = index + 1;
		const agent = byLength.find(
			(candidate) =>
				candidate.name.length > 0 &&
				lower.startsWith(candidate.name.toLowerCase(), start) &&
				!isNameCharacter(content[start + candidate.name.length]),
		);
		if (agent === undefined) continue;

		mentions.push({ agentId: agent.id, start: index, end: start + agent.name.length });
		index = start + agent.name.length - 1;
	}

	return mentions;
}

function isNameCharacter(character: string | undefined): boolean {
	return character !== undefined && /[\w-]/.test(character);
}
