/** What a run has produced so far: what it was started with, under input, and each step by its id. */
export type Results = Record<string, unknown>;

/** A step whose condition did not hold ran nothing, which is not the same as producing nothing. */
export const skipped = Symbol("skipped");

/** A value that is nothing but one reference keeps its type; anywhere else a reference reads as text. */
const whole = /^\{\{\s*([\w-]+)(?:\.([\w.-]+))?\s*\}\}$/;
const anywhere = /\{\{\s*([\w-]+)(?:\.([\w.-]+))?\s*\}\}/g;

/** What a step is given: its written input with everything it reads filled in from what came before. */
export function resolve(value: unknown, results: Results): unknown {
	if (typeof value === "string") return resolved(value, results);
	if (Array.isArray(value)) return value.map((one) => resolve(one, results));
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(Object.entries(value).map(([name, held]) => [name, resolve(held, results)]));
	}

	return value;
}

/** Truthiness and nothing more: a condition asks whether what came before amounts to anything. */
export function holds(when: string, results: Results): boolean {
	const value = resolve(when, results);
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === "string") return value.trim().length > 0;

	return Boolean(value);
}

function resolved(text: string, results: Results): unknown {
	const only = whole.exec(text);
	if (only !== null) return read(only[1], only[2], results);

	return text.replace(anywhere, (_, step: string, field?: string) => written(read(step, field, results)));
}

function read(step: string, field: string | undefined, results: Results): unknown {
	if (!(step in results)) throw new Error(`Nothing here is called ${step}`);
	if (results[step] === skipped) throw new Error(`${step} was skipped, so it produced nothing to read`);

	const held = results[step];
	if (field === undefined) return held;

	return field.split(".").reduce<unknown>((value, name) => {
		if (typeof value !== "object" || value === null || !(name in value)) {
			throw new Error(`${step} says nothing about ${field}`);
		}

		return (value as Record<string, unknown>)[name];
	}, held);
}

function written(value: unknown): string {
	if (value === undefined || value === null) return "";

	return typeof value === "string" ? value : JSON.stringify(value);
}
