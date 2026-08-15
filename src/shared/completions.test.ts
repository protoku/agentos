import { describe, expect, it } from "vitest";
import { completionAt } from "./completions";

const tools = [
	{ id: "write_file", name: "write_file", description: "Create a file." },
	{ id: "read_file", name: "read_file", description: "Read a file." },
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

	it("offers nothing once the caret leaves the first token, where the arguments start", () => {
		expect(at("/read_file path=a.txt")).toBeUndefined();
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
