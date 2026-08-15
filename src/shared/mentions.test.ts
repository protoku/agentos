import { describe, expect, it } from "vitest";
import { findMentions } from "./mentions";

const agents = [
	{ id: "agent-ops", name: "ops" },
	{ id: "agent-qa", name: "qa" },
	{ id: "agent-review", name: "code review" },
];

function ids(content: string): string[] {
	return findMentions(content, agents).map((mention) => mention.agentId);
}

describe("findMentions", () => {
	it("resolves a mention to the agent id", () => {
		expect(ids("@ops please deploy")).toEqual(["agent-ops"]);
	});

	it("keeps mention order and repeats, since every mention is its own turn", () => {
		expect(ids("@qa then @ops then @qa again")).toEqual(["agent-qa", "agent-ops", "agent-qa"]);
	});

	it("ignores an @name no agent answers to", () => {
		expect(ids("@nobody are you there")).toEqual([]);
	});

	it("does not match a longer word that starts with an agent name", () => {
		expect(ids("@opsy is someone else")).toEqual([]);
	});

	it("matches the longest agent name", () => {
		expect(ids("@code review the diff")).toEqual(["agent-review"]);
	});

	it("is case insensitive", () => {
		expect(ids("@OPS deploy")).toEqual(["agent-ops"]);
	});

	it("reports where the mention sits in the text", () => {
		expect(findMentions("hey @ops!", agents)).toEqual([{ agentId: "agent-ops", start: 4, end: 8 }]);
	});
});
