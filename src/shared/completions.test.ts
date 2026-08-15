import { describe, expect, it } from "vitest";
import { completionAt } from "./completions";
import type { BuiltinTool } from "./types";

const tools: BuiltinTool[] = [
	{
		type: "builtin",
		id: "write_file",
		name: "write_file",
		description: "Create a file.",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path relative to the sandbox" },
				content: { type: "string" },
			},
			required: ["path", "content"],
		},
		outputSchema: {},
	},
	{
		type: "builtin",
		id: "read_file",
		name: "read_file",
		description: "Read a file.",
		inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
		outputSchema: {},
	},
];

const agents = [
	{ id: "agent-ops", name: "ops" },
	{ id: "agent-sre", name: "sre" },
];

function at(draft: string, caret = draft.length) {
	return completionAt(draft, caret, tools, agents);
}

describe("completionAt", () => {
	it("offers every tool on a bare slash, and narrows as the name is typed", () => {
		expect(at("/")?.candidates).toHaveLength(2);
		expect(at("/re")?.candidates.map((candidate) => candidate.name)).toEqual(["read_file"]);
	});

	it("replaces the whole tool name, even the part after the caret", () => {
		expect(at("/read_file", 3)).toMatchObject({ start: 1, end: 10 });
	});

	it("offers the tool's arguments once it is named, each taking a value", () => {
		expect(at("/write_file ")).toMatchObject({
			suffix: "=",
			candidates: [{ name: "path", description: "Path relative to the sandbox" }, { name: "content" }],
		});
		expect(at("/write_file co")?.candidates.map((candidate) => candidate.name)).toEqual(["content"]);
		expect(at("/write_file co")).toMatchObject({ start: 12, end: 14 });
	});

	it("offers nothing inside an argument's value, which is the caller's to write", () => {
		expect(at("/read_file path=a.txt")).toBeUndefined();
	});

	it("offers no arguments for a tool it does not know", () => {
		expect(at("/fly_to_moon ")).toBeUndefined();
	});

	it("offers agents on an @ anywhere in a message", () => {
		expect(at("@")?.candidates).toHaveLength(2);
		expect(at("please @op")?.candidates.map((candidate) => candidate.name)).toEqual(["ops"]);
		expect(at("please @op", 9)).toMatchObject({ start: 8, end: 10 });
	});

	it("leaves an @ that is part of a word alone", () => {
		expect(at("mail@op")).toBeUndefined();
	});

	it("offers no agent inside a slash command, which carries no mentions", () => {
		expect(at('/write_file content="@op')).toBeUndefined();
	});

	it("offers nothing when the name matches none, or when there is no name to complete", () => {
		expect(at("/nope")).toBeUndefined();
		expect(at("@zz")).toBeUndefined();
		expect(at("just a message")).toBeUndefined();
		expect(at("")).toBeUndefined();
	});
});
