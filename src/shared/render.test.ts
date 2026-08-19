import { describe, expect, it } from "vitest";
import { cell, fieldsOf, pathOf } from "./render";

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

	it("reads rows of the same kind of thing as a table, columns as the items declare them", () => {
		const said = {
			type: "object",
			properties: {
				matches: {
					type: "array",
					render: "table",
					items: { type: "object", properties: { path: { type: "string" }, line: { type: "number" } } },
				},
			},
		};

		expect(fieldsOf(said, { matches: [{ line: 3, path: "a.txt" }] })).toEqual([
			{ name: "matches", kind: "table", columns: ["path", "line"], rows: [{ line: 3, path: "a.txt" }] },
		]);
	});

	it("keeps a column the rows carry but the items never declared", () => {
		const said = {
			type: "object",
			properties: {
				rows: { type: "array", render: "table", items: { type: "object", properties: { a: { type: "string" } } } },
			},
		};
		const fields = fieldsOf(said, { rows: [{ a: "1" }, { a: "2", b: "3" }] });

		expect(fields[0]).toMatchObject({ columns: ["a", "b"] });
	});

	it("takes columns from the rows when the items declare nothing", () => {
		const said = { type: "object", properties: { rows: { type: "array", render: "table" } } };
		const fields = fieldsOf(said, { rows: [{ name: "a" }, { name: "b", size: 2 }] });

		expect(fields[0]).toMatchObject({ kind: "table", columns: ["name", "size"] });
	});

	it("falls back when a table holds no rows, or holds something other than rows", () => {
		const said = { type: "object", properties: { rows: { type: "array", render: "table" } } };

		expect(fieldsOf(said, { rows: [] })[0]).toEqual({ name: "rows", kind: "inline", written: "[]" });
		expect(fieldsOf(said, { rows: ["a", "b"] })[0]?.kind).toBe("block");
	});

	it("writes a cell as it reads, and anything with parts of its own as JSON", () => {
		expect([cell("a"), cell(3), cell(true), cell(null), cell(undefined)]).toEqual(["a", "3", "true", "", ""]);
		expect(cell(["a", "b"])).toBe('["a","b"]');
	});

	it("takes a link only where a browser could go, and reads the rest as it stands", () => {
		const said = { type: "object", properties: { url: { type: "string", render: "link" } } };
		const kinds = ["https://x.test", "http://x.test", "javascript:alert(1)", "file:///etc/passwd", "./relative"].map(
			(url) => fieldsOf(said, { url })[0]?.kind,
		);

		expect(kinds).toEqual(["link", "link", "inline", "inline", "inline"]);
	});

	it("falls back on a path or a diff that holds nothing", () => {
		const said = {
			type: "object",
			properties: { path: { type: "string", render: "path" }, diff: { type: "string", render: "diff" } },
		};

		expect(fieldsOf(said, { path: "", diff: "@@ -1 +1 @@" })).toEqual([
			{ name: "path", kind: "inline", written: "" },
			{ name: "diff", kind: "diff", value: "@@ -1 +1 @@" },
		]);
	});

	it("writes what is not a string as JSON", () => {
		const fields = fieldsOf(undefined, { ok: true, entries: [{ name: "a.txt" }] });

		expect(fields[0]).toEqual({ name: "ok", kind: "inline", written: "true" });
		expect(fields[1]?.kind).toBe("block");
	});
});

describe("pathOf", () => {
	const moving = {
		type: "script" as const,
		id: "t",
		name: "move",
		createdAt: "",
		description: "",
		code: "",
		env: [],
		inputSchema: {
			type: "object",
			properties: { from: { type: "string", render: "path" }, to: { type: "string", render: "path" } },
		},
		outputSchema: { type: "object", properties: { wrote: { type: "string", render: "path" } } },
	};
	const call = {
		type: "toolCall" as const,
		id: "c",
		toolId: "t",
		status: "success" as const,
		input: { from: "a.txt", to: "b.txt" },
		createdAt: "",
	};

	it("opens the last place a call named, since a move ends at its destination", () => {
		expect(pathOf(call, moving)).toBe("b.txt");
	});

	it("opens what a call wrote when its input named no place", () => {
		expect(pathOf({ ...call, input: {}, output: { wrote: "c.txt" } }, moving)).toBe("c.txt");
	});

	it("still opens what a tool that declares nothing acted on", () => {
		expect(pathOf(call)).toBe("b.txt");
		expect(pathOf({ ...call, input: { path: "a.txt" } })).toBe("a.txt");
		expect(pathOf({ ...call, input: { pattern: "x" } })).toBeUndefined();
	});
});
