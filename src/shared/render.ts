import type { Tool, ToolCall } from "./types";

/**
 * How a payload reads: each field as the tool's schema declares it, in the order that schema names
 * them, with whatever it never mentioned after. A declaration the value does not fit, or a kind this
 * version does not know, falls back to reading the value for what it holds.
 */
export type Field =
	| { name: string; kind: "table"; columns: string[]; rows: Record<string, unknown>[] }
	| { name: string; kind: "text" | "markdown" | "diff" | "path" | "link"; value: string }
	| { name: string; kind: "inline" | "block"; written: string };

/** Longer than this, or carrying lines of its own, and a value needs a block rather than a line. */
const inlineLimit = 120;

export function fieldsOf(schema: Record<string, unknown> | undefined, payload: Record<string, unknown>): Field[] {
	const declared = Object.keys(propertiesOf(schema));
	const rest = Object.keys(payload).filter((name) => !declared.includes(name));

	return [...declared, ...rest]
		.filter((name) => payload[name] !== undefined)
		.map((name) => read(name, payload[name], propertyOf(schema, name)));
}

/** What one cell shows: a value as it reads, and anything with parts of its own as JSON. */
export function cell(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;

	return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function read(name: string, value: unknown, property: Record<string, unknown> | undefined): Field {
	const kind = kindOf(property);

	if (kind === "table") {
		const rows = rowsOf(value);
		if (rows !== undefined) return { name, kind, columns: columnsOf(property, rows), rows };
	}

	if (typeof value === "string" && value.length > 0) {
		if (kind === "text" || kind === "markdown" || kind === "diff" || kind === "path") return { name, kind, value };
		if (kind === "link" && isAddress(value)) return { name, kind, value };
	}

	const written = typeof value === "string" ? value : JSON.stringify(value, null, 2);

	return { name, kind: written.includes("\n") || written.length > inlineLimit ? "block" : "inline", written };
}

/**
 * An address is somewhere a browser can go and nothing else: a link is the one kind that hands a
 * value straight to the machine, so what it may hold is decided here rather than where it is drawn.
 */
function isAddress(value: string): boolean {
	const address = URL.parse(value);

	return address?.protocol === "http:" || address?.protocol === "https:";
}

/** A table is rows of the same kind of thing; anything else is not one, however it was declared. */
function rowsOf(value: unknown): Record<string, unknown>[] | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;

	return value.every(isRecord) ? value : undefined;
}

/** Columns are what the items declare, then whatever the rows turned out to carry as well. */
function columnsOf(property: Record<string, unknown> | undefined, rows: Record<string, unknown>[]): string[] {
	const items = property?.["items"];
	const declared = Object.keys(propertiesOf(isRecord(items) ? items : undefined));
	const rest = rows.flatMap((row) => Object.keys(row)).filter((name) => !declared.includes(name));

	return [...declared, ...new Set(rest)];
}

function kindOf(property: Record<string, unknown> | undefined): string | undefined {
	const declared = property?.["render"];

	return typeof declared === "string" ? declared : undefined;
}

function propertyOf(schema: Record<string, unknown> | undefined, name: string): Record<string, unknown> | undefined {
	const property = propertiesOf(schema)[name];

	return isRecord(property) ? property : undefined;
}

function propertiesOf(schema: Record<string, unknown> | undefined): Record<string, unknown> {
	const found = schema?.["properties"];

	return isRecord(found) ? found : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What a call opens in the viewer: the last place it named, its schema being what says so. */
export function pathOf(call: ToolCall, tool?: Tool): string | undefined {
	const named = placeIn(tool?.inputSchema, call.input) ?? placeIn(tool?.outputSchema, call.output);
	if (named !== undefined) return named;

	// A call by a tool that declares nothing still opens what it acted on, as it always has.
	const guessed = call.input["to"] ?? call.input["path"];

	return typeof guessed === "string" ? guessed : undefined;
}

function placeIn(schema: Record<string, unknown> | undefined, payload: Record<string, unknown> | undefined) {
	if (payload === undefined) return undefined;

	let found: string | undefined;
	// A call that moves something ends at its destination, so the last path named is the one to open.
	for (const field of fieldsOf(schema, payload)) if (field.kind === "path") found = field.value;

	return found;
}
