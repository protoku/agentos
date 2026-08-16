import { z } from "zod";

/**
 * The schemas a script tool carries are written as JSON, which is what its author edits and what
 * an agent is shown. This is the same schema as a checker: the supported subset is objects with
 * typed properties, enums, arrays and nesting; anything else is accepted as given.
 */
export function zodObjectFrom(schema: Record<string, unknown>): z.ZodObject {
	const properties = isRecord(schema.properties) ? schema.properties : {};
	const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
	const shape: Record<string, z.ZodType> = {};

	for (const [name, property] of Object.entries(properties)) {
		const type = zodTypeFrom(isRecord(property) ? property : {});
		shape[name] = required.has(name) ? type : type.optional();
	}

	return z.object(shape);
}

function zodTypeFrom(property: Record<string, unknown>): z.ZodType {
	const type = build(property);

	return typeof property.description === "string" ? type.describe(property.description) : type;
}

function build(property: Record<string, unknown>): z.ZodType {
	if (Array.isArray(property.enum) && property.enum.length > 0) return z.enum(property.enum.map(String));

	switch (property.type) {
		case "string":
			return z.string();
		case "number":
			return z.number();
		case "integer":
			return z.number().int();
		case "boolean":
			return z.boolean();
		case "array":
			return z.array(isRecord(property.items) ? zodTypeFrom(property.items) : z.unknown());
		case "object":
			return zodObjectFrom(property);
		default:
			return z.unknown();
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
