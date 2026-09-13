import type { Agent, MountSource, Tool, Workflow } from "./types";

export interface Candidate {
	id: string;
	name: string;
	description?: string;
	/** What lands in the draft, when it is not the name itself, such as a value that needs quoting. */
	insert?: string;
}

/** What the composer can complete at the caret, and the range an accepted name replaces. */
export interface Completion {
	start: number;
	end: number;
	/** What follows an accepted name: a space for a tool, an agent or a value, = for an argument. */
	suffix: string;
	candidates: Candidate[];
}

/** Of what an argument declares, the words the composer shows and what it says the value may be. */
interface Property {
	description?: string;
	type?: unknown;
	enum?: unknown[];
	values?: unknown;
}

type Sources = Pick<MountSource, "id" | "name">[];

export function completionAt(
	draft: string,
	caret: number,
	tools: Tool[],
	agents: Pick<Agent, "id" | "name">[],
	sources: Sources,
	workflows: Pick<Workflow, "id" | "name" | "description">[] = [],
): Completion | undefined {
	// A slash command names its tool in the first token, then its arguments, and carries no mentions.
	if (draft.startsWith("/")) {
		const name = draft.slice(1).split(/\s/)[0];
		// One namespace: what a slash names is a tool of the workspace or a workflow of it.
		const runnable = [...tools, ...workflows];
		if (caret <= name.length + 1) return matching(runnable, draft.slice(1, caret), 1, nameEnd(draft, caret), " ");

		return argumentsOf(draft, caret, tools.find((tool) => tool.name === name), sources);
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

/** The arguments a tool takes, each accepted as name=, since a value follows it, and then that value. */
function argumentsOf(draft: string, caret: number, tool: Tool | undefined, sources: Sources): Completion | undefined {
	if (tool === undefined) return undefined;

	const properties = tool.inputSchema.properties;
	if (typeof properties !== "object" || properties === null) return undefined;
	const declared = properties as Record<string, Property>;

	const start = draft.lastIndexOf(" ", caret - 1) + 1;
	const typed = draft.slice(start, caret);

	const equals = typed.indexOf("=");
	if (equals >= 0) return valueOf(draft, caret, declared[typed.slice(0, equals)], start + equals + 1, sources);

	const named = Object.entries(declared).map(([name, property]) => ({
		id: name,
		name,
		description: property.description,
	}));

	return matching(named, typed, start, nameEnd(draft, caret), "=");
}

/** What an argument may hold, where its schema says: anything else stays the caller's to write. */
function valueOf(
	draft: string,
	caret: number,
	property: Property | undefined,
	start: number,
	sources: Sources,
): Completion | undefined {
	const allowed = allowedBy(property, sources);
	if (allowed === undefined) return undefined;

	const prefix = draft.slice(start, caret);
	// A value already carrying a quote is being written by hand, so the list stays out of its way.
	if (prefix.includes('"')) return undefined;

	const writable = allowed.map((candidate) => ({ ...candidate, ...quoting(candidate.name) }));

	return offering(writable, prefix, start, valueEnd(draft, caret), " ");
}

function allowedBy(property: Property | undefined, sources: Sources): Candidate[] | undefined {
	if (property === undefined) return undefined;

	if (Array.isArray(property.enum)) return property.enum.map((value) => choice(String(value)));
	if (property.type === "boolean") return [choice("true"), choice("false")];
	if (property.values === "sources") return sources.map((source) => ({ id: source.id, name: source.name }));

	return undefined;
}

function choice(value: string): Candidate {
	return { id: value, name: value };
}

/** A value is written as it reads while it is one bare token, and quoted once it cannot be. */
function quoting(value: string): { insert?: string } {
	if (/^[^\s"\\]+$/.test(value)) return {};

	return { insert: `"${value.replace(/["\\]/g, "\\$&")}"` };
}

function matching(
	named: Candidate[],
	prefix: string,
	start: number,
	end: number,
	suffix: string,
): Completion | undefined {
	if (!isName(prefix)) return undefined;

	return offering(named, prefix, start, end, suffix);
}

function offering(
	named: Candidate[],
	prefix: string,
	start: number,
	end: number,
	suffix: string,
): Completion | undefined {
	const candidates = named.filter((candidate) => candidate.name.toLowerCase().startsWith(prefix.toLowerCase()));

	return candidates.length === 0 ? undefined : { start, end, suffix, candidates };
}

/** The name being completed runs past the caret, so accepting replaces all of it. */
function nameEnd(draft: string, caret: number): number {
	let end = caret;
	while (isNameCharacter(draft[end])) end++;

	return end;
}

/** A value runs to the next space, which is where the argument after it begins. */
function valueEnd(draft: string, caret: number): number {
	let end = caret;
	while (draft[end] !== undefined && !/\s/.test(draft[end])) end++;

	return end;
}

function isName(text: string): boolean {
	return /^[\w-]*$/.test(text);
}

function isNameCharacter(character: string | undefined): boolean {
	return character !== undefined && /[\w-]/.test(character);
}
