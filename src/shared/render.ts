/**
 * How a payload reads: each field as the tool's schema declares it, in the order that schema names
 * them, with whatever it never mentioned after. A declaration the value does not fit, or a kind this
 * version does not know, falls back to reading the value for what it holds.
 */
export type Field =
	| { name: string; kind: "text" | "markdown"; value: string }
	| { name: string; kind: "inline" | "block"; written: string };

/** Longer than this, or carrying lines of its own, and a value needs a block rather than a line. */
const inlineLimit = 120;

export function fieldsOf(schema: Record<string, unknown> | undefined, payload: Record<string, unknown>): Field[] {
	const declared = Object.keys(propertiesOf(schema));
	const rest = Object.keys(payload).filter((name) => !declared.includes(name));

	return [...declared, ...rest]
		.filter((name) => payload[name] !== undefined)
		.map((name) => read(name, payload[name], kindOf(schema, name)));
}

function read(name: string, value: unknown, kind: string | undefined): Field {
	if ((kind === "text" || kind === "markdown") && typeof value === "string") return { name, kind, value };

	const written = typeof value === "string" ? value : JSON.stringify(value, null, 2);

	return { name, kind: written.includes("\n") || written.length > inlineLimit ? "block" : "inline", written };
}

function kindOf(schema: Record<string, unknown> | undefined, name: string): string | undefined {
	const property = propertiesOf(schema)[name];
	const declared = isRecord(property) ? property["render"] : undefined;

	return typeof declared === "string" ? declared : undefined;
}

function propertiesOf(schema: Record<string, unknown> | undefined): Record<string, unknown> {
	const found = schema?.["properties"];

	return isRecord(found) ? found : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
