import { describe, expect, it } from "vitest";
import { fieldsOf } from "./render";

const schema = {
	type: "object",
	properties: {
		path: { type: "string" },
		find: { type: "string", render: "text" },
		replace: { type: "string", render: "text" },
	},
};

describe("fieldsOf", () => {
	it("reads fields in the order the schema names them, whatever order they arrived in", () => {
		const fields = fieldsOf(schema, { replace: "b", path: "a.txt", find: "a" });

		expect(fields.map((field) => field.name)).toEqual(["path", "find", "replace"]);
	});

	it("keeps a field the schema never mentioned, after the ones it did", () => {
		const fields = fieldsOf(schema, { extra: "kept", path: "a.txt" });

		expect(fields.map((field) => field.name)).toEqual(["path", "extra"]);
	});

	it("leaves out a field the payload does not carry", () => {
		const fields = fieldsOf(schema, { path: "a.txt" });

		expect(fields).toEqual([{ name: "path", kind: "inline", written: "a.txt" }]);
	});

	it("reads a declared text field in a block however short it is", () => {
		const fields = fieldsOf(schema, { find: "a" });

		expect(fields).toEqual([{ name: "find", kind: "text", value: "a" }]);
	});

	it("falls back when the value is not what the declaration says", () => {
		const said = { type: "object", properties: { report: { type: "string", render: "markdown" } } };

		expect(fieldsOf(said, { report: 12 })).toEqual([{ name: "report", kind: "inline", written: "12" }]);
	});

	it("falls back on a kind it does not know", () => {
		const said = { type: "object", properties: { chart: { type: "string", render: "sunburst" } } };

		expect(fieldsOf(said, { chart: "later" })).toEqual([{ name: "chart", kind: "inline", written: "later" }]);
	});

	it("gives a block to what has lines or length, and a line to what has neither", () => {
		const fields = fieldsOf(undefined, { one: "short", many: "one\ntwo", long: "x".repeat(121) });

		expect(fields.map((field) => field.kind)).toEqual(["inline", "block", "block"]);
	});

	it("writes what is not a string as JSON", () => {
		const fields = fieldsOf(undefined, { ok: true, entries: [{ name: "a.txt" }] });

		expect(fields[0]).toEqual({ name: "ok", kind: "inline", written: "true" });
		expect(fields[1]?.kind).toBe("block");
	});
});
