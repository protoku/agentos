import type { Memory } from "./types";

/** Enough for what one agent should always know, so a broad tag never fills its prompt. */
const carriedLimit = 20;

/**
 * A tag is an identifier rather than prose: an agent carries a tag by matching it exactly, so
 * Deploy, deploy and deploy process would otherwise be three different places to file one thing.
 */
export function asTags(given: string[]): string[] {
	const tags = given.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0);

	for (const tag of tags) {
		if (!/^[a-z0-9][a-z0-9_-]*$/.test(tag)) {
			throw new Error(`${tag} is not a tag: use letters, digits, hyphens and underscores`);
		}
	}

	return [...new Set(tags)];
}

/**
 * What a search finds: every memory carrying all the tags asked for and every word looked for,
 * anywhere in its title, body or tags, best first. Asking for nothing is asking for everything.
 */
export function matchMemories(memories: Memory[], asked: { query?: string; tags?: string[] }): Memory[] {
	const terms = (asked.query ?? "").toLowerCase().split(/\s+/).filter((term) => term.length > 0);
	const tags = asTags(asked.tags ?? []);

	const found = memories
		.filter((memory) => tags.every((tag) => memory.tags.includes(tag)))
		.filter((memory) => terms.every((term) => holds(memory, term)));

	return found.sort((a, b) => weigh(b, terms) - weigh(a, terms) || byNewest(a, b));
}

/** What an agent is handed before every turn, most recently changed first. */
export function carriedMemories(memories: Memory[], carries: string[]): Memory[] {
	if (carries.length === 0) return [];

	return memories.filter((memory) => memory.tags.some((tag) => carries.includes(tag))).sort(byNewest);
}

/**
 * The memories as an agent reads them, ordered by title rather than by recency: what is carried is
 * chosen by what changed last, but reshuffling the block on every correction would cost the whole
 * prompt its cache. Ids are printed so a memory found wrong can be corrected without a search first.
 */
export function memoryBlock(carried: Memory[]): string {
	if (carried.length === 0) return "";

	const shown = carried.slice(0, carriedLimit).sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
	const written = shown.map(
		(memory) =>
			`### ${memory.title}\nId: ${memory.id}` +
			(memory.tags.length > 0 ? `\nTags: ${memory.tags.join(", ")}` : "") +
			`\n\n${memory.body}`,
	);

	return [
		"## Memory",
		"",
		"What this workspace knows and hands you because you carry its tags.",
		"Correct it with the memory tools when it turns out to be wrong.",
		"",
		...written.flatMap((memory) => [memory, ""]),
		...(carried.length > shown.length
			? [`${shown.length} of ${carried.length} memories, the most recently changed. Search for the rest.`]
			: []),
	]
		.join("\n")
		.trimEnd();
}

/** A term is looked for wherever a memory says anything: its title, its body and its tags. */
function holds(memory: Memory, term: string): boolean {
	return `${memory.title}\n${memory.body}\n${memory.tags.join(" ")}`.toLowerCase().includes(term);
}

/** A title hit says more about a memory than a body hit, and a tag it is filed under says more still. */
function weigh(memory: Memory, terms: string[]): number {
	return terms.reduce(
		(score, term) =>
			score +
			(memory.title.toLowerCase().includes(term) ? 3 : 0) +
			(memory.tags.includes(term) ? 2 : 0) +
			(memory.body.toLowerCase().includes(term) ? 1 : 0),
		0,
	);
}

function byNewest(a: Memory, b: Memory): number {
	return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
}
