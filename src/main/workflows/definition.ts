import { parse } from "yaml";

/** What a workflow does, in the order it does it. Read from the definition, never stored apart. */
export interface Plan {
	input: Record<string, unknown>;
	steps: Step[];
}

export interface Step {
	id: string;
	/** Truthy to run the step, absent to always run it. */
	when?: string;
	/** A tool step names its tool and what to call it with. */
	tool?: string;
	input?: Record<string, unknown>;
	/** An agent step names its agent, what it is asked for, and what it must declare. */
	agent?: string;
	ask?: string;
	result?: Record<string, unknown>;
}

/** A reference to what an earlier step produced, or to what the run was started with. */
const reference = /\{\{\s*([\w-]+)(?:\.([\w.-]+))?\s*\}\}/g;

/**
 * The definition as written, read and checked. Names of tools and agents are not checked here:
 * a workflow is often written before the tool it will call exists, and the run says what is missing.
 */
export function parseDefinition(definition: string): Plan {
	const read: unknown = read_(definition);
	if (typeof read !== "object" || read === null) raise("A workflow is written as input and steps");

	const { input, steps } = read as { input?: unknown; steps?: unknown };
	if (input !== undefined && (typeof input !== "object" || input === null || Array.isArray(input))) {
		raise("input names the arguments the workflow takes");
	}
	if (!Array.isArray(steps) || steps.length === 0) raise("A workflow needs at least one step");

	const known = new Set(["input"]);
	const plan: Plan = { input: (input ?? {}) as Record<string, unknown>, steps: steps.map(stepOf) };

	for (const step of plan.steps) {
		if (known.has(step.id)) raise(`Two steps are called ${step.id}`);
		for (const name of referencedBy(step)) {
			if (!known.has(name)) raise(`${step.id} reads ${name}, which nothing before it produced`);
		}
		known.add(step.id);
	}

	return plan;
}

/** Every step of a plan, in order, with what it reads written out. */
export function referencesIn(text: string): string[] {
	return [...text.matchAll(reference)].map((found) => found[1]);
}

/** What a value holds, wherever it holds it: a step reads from strings nested anywhere in its input. */
export function textIn(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(textIn);
	if (typeof value === "object" && value !== null) return Object.values(value).flatMap(textIn);

	return [];
}

function referencedBy(step: Step): string[] {
	return [step.when, step.ask, ...textIn(step.input)]
		.filter((text): text is string => typeof text === "string")
		.flatMap(referencesIn);
}

function stepOf(step: unknown, index: number): Step {
	if (typeof step !== "object" || step === null) raise(`Step ${index + 1} is not written as a step`);

	const written = step as Step;
	if (typeof written.id !== "string" || !/^[\w-]+$/.test(written.id)) {
		raise(`Step ${index + 1} needs an id of letters, digits, hyphens and underscores`);
	}
	if ((written.tool === undefined) === (written.agent === undefined)) {
		raise(`${written.id} names either a tool or an agent, and this one names ${written.tool ? "both" : "neither"}`);
	}
	if (written.agent === undefined && written.ask !== undefined) raise(`${written.id} asks, but names no agent`);
	if (written.tool === undefined && written.input !== undefined) raise(`${written.id} has input, but names no tool`);

	return written;
}

function read_(definition: string): unknown {
	try {
		return parse(definition);
	} catch (failure) {
		return raise(failure instanceof Error ? failure.message : String(failure));
	}
}

function raise(message: string): never {
	throw new Error(message);
}
