import type { Agent, Tool } from "./types";

export interface Candidate {
	id: string;
	name: string;
	description?: string;
}

/** What the composer can complete at the caret, and the range an accepted name replaces. */
export interface Completion {
	start: number;
	end: number;
	/** What follows an accepted name: a space for a tool or an agent, = for an argument. */
	suffix: string;
	candidates: Candidate[];
}

export function completionAt(
	draft: string,
	caret: number,
	tools: Tool[],
	agents: Pick<Agent, "id" | "name">[],
): Completion | undefined {
	// A slash command names its tool in the first token, then its arguments, and carries no mentions.
	if (draft.startsWith("/")) {
		const name = draft.slice(1).split(/\s/)[0];
		if (caret <= name.length + 1) return matching(tools, draft.slice(1, caret), 1, nameEnd(draft, caret), " ");

		return argumentsOf(draft, caret, tools.find((tool) => tool.name === name));
	}

	for (let index = caret - 1; index >= 0; index--) {
		if (draft[index] === "@") {
			if (isNameCharacter(draft[index - 1])) return undefined;

			return matching(agents, draft.slice(index + 1, caret), index + 1, nameEnd(draft, caret), " ");
		}
		if (!isNameCharacter(draft[index])) return undefined;
	}

	return undefined;
}

/** The arguments a tool takes, each accepted as name=, since a value follows it. */
function argumentsOf(draft: string, caret: number, tool: Tool | undefined): Completion | undefined {
	if (tool === undefined) return undefined;

	const properties = tool.inputSchema.properties;
	if (typeof properties !== "object" || properties === null) return undefined;

	const start = draft.lastIndexOf(" ", caret - 1) + 1;
	const typed = draft.slice(start, caret);
	if (typed.includes("=")) return undefined;

	const named = Object.entries(properties as Record<string, { description?: string }>).map(([name, property]) => ({
		id: name,
		name,
		description: property.description,
	}));

	return matching(named, typed, start, nameEnd(draft, caret), "=");
}

function matching(
	named: Candidate[],
	prefix: string,
	start: number,
	end: number,
	suffix: string,
): Completion | undefined {
	if (!isName(prefix)) return undefined;

	const candidates = named.filter((candidate) => candidate.name.toLowerCase().startsWith(prefix.toLowerCase()));

	return candidates.length === 0 ? undefined : { start, end, suffix, candidates };
}

/** The name being completed runs past the caret, so accepting replaces all of it. */
function nameEnd(draft: string, caret: number): number {
	let end = caret;
	while (isNameCharacter(draft[end])) end++;

	return end;
}

function isName(text: string): boolean {
	return /^[\w-]*$/.test(text);
}

function isNameCharacter(character: string | undefined): boolean {
	return character !== undefined && /[\w-]/.test(character);
}
