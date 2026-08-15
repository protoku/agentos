import type { Agent, BuiltinTool } from "./types";

export interface Candidate {
	id: string;
	name: string;
	description?: string;
}

/** What the composer can complete at the caret, and the range an accepted name replaces. */
export interface Completion {
	start: number;
	end: number;
	candidates: Candidate[];
}

export function completionAt(
	draft: string,
	caret: number,
	tools: Pick<BuiltinTool, "id" | "name" | "description">[],
	agents: Pick<Agent, "id" | "name">[],
): Completion | undefined {
	// A slash command names its tool in the first token, and carries no mentions anywhere.
	if (draft.startsWith("/")) {
		if (!isName(draft.slice(1, caret)) || caret === 0) return undefined;

		return matching(tools, draft.slice(1, caret), 1, nameEnd(draft, caret));
	}

	for (let index = caret - 1; index >= 0; index--) {
		if (draft[index] === "@") {
			if (isNameCharacter(draft[index - 1])) return undefined;

			return matching(agents, draft.slice(index + 1, caret), index + 1, nameEnd(draft, caret));
		}
		if (!isNameCharacter(draft[index])) return undefined;
	}

	return undefined;
}

function matching(named: Candidate[], prefix: string, start: number, end: number): Completion | undefined {
	if (!isName(prefix)) return undefined;

	const candidates = named.filter((candidate) => candidate.name.toLowerCase().startsWith(prefix.toLowerCase()));

	return candidates.length === 0 ? undefined : { start, end, candidates };
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
