import { describe, expect, it } from "vitest";
import { estimateTokens, tokens, transcript } from "./transcript";
import type { Agent, Entry } from "./types";

const ops: Agent = {
	id: "agent-ops",
	name: "ops",
	createdAt: "2026-08-15T10:00:00.000Z",
	model: "claude-opus-5",
	systemPrompt: "You watch deploys.",
	tools: {},
	carries: [],
};

const entries: Entry[] = [
	{ type: "userMessage", id: "m1", mentions: [ops.id], content: "@ops deploy", createdAt: "" },
	{ type: "turnStart", id: "t1", agentId: ops.id, createdAt: "" },
	{ type: "agentMessage", id: "m2", agentId: ops.id, turnId: "t1", content: "On it", createdAt: "" },
	{
		type: "toolCall",
		id: "c1",
		toolId: "write_file",
		input: { path: "a.txt" },
		output: { bytes: 3 },
		status: "success",
		createdAt: "",
	},
	{ type: "turnEnd", id: "e1", turnId: "t1", status: "finished", createdAt: "" },
];

describe("transcript", () => {
	it("names the acting agent and renders the thread", () => {
		const text = transcript(entries, [ops], ops);

		expect(text).toContain("You are the agent @ops");
		expect(text).toContain("user: @ops deploy");
		expect(text).toContain("@ops: On it");
		expect(text).toContain('user ran write_file (success) with {"path":"a.txt"} and got {"bytes":3}');
	});

	it("leaves turn markers out, since they carry nothing to read", () => {
		expect(transcript(entries, [ops], ops)).not.toContain("turnStart");
	});
});

describe("tokens", () => {
	it("counts four characters to the token, on the thread's own lines", () => {
		const one: Entry[] = [{ type: "userMessage", id: "m1", content: "0123456789", createdAt: "" }];

		// The line is "user: 0123456789": sixteen characters, and nothing of the turn around it.
		expect(tokens(one, [ops])).toBe(4);
		expect(tokens([], [ops])).toBe(0);
	});

	it("counts nothing for a call that has not settled, which no turn is sent", () => {
		const pending: Entry = {
			type: "toolCall",
			id: "c2",
			toolId: "read_file",
			input: { path: "big.txt" },
			status: "pending",
			createdAt: "",
		};

		expect(tokens([...entries, pending], [ops])).toBe(tokens(entries, [ops]));
	});

	it("adds nothing for turn markers, which carry no content", () => {
		const spoken = entries.filter((entry) => entry.type !== "turnStart" && entry.type !== "turnEnd");

		expect(tokens(entries, [ops])).toBe(tokens(spoken, [ops]));
	});
});

describe("estimateTokens", () => {
	it("measures any text by the same rule of thumb as a thread", () => {
		expect(estimateTokens("")).toBe(0);
		expect(estimateTokens("x".repeat(400))).toBe(100);
	});
});
