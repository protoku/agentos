import { describe, expect, it } from "vitest";
import { tokens, transcript } from "./transcript";
import type { Agent, Entry } from "./types";

const ops: Agent = {
	id: "agent-ops",
	name: "ops",
	createdAt: "2026-08-15T10:00:00.000Z",
	model: "claude-opus-5",
	systemPrompt: "You watch deploys.",
	tools: {},
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
	it("measures the thread, and an empty one costs nothing", () => {
		expect(tokens([], [ops])).toBe(0);
		expect(tokens(entries, [ops])).toBeGreaterThan(0);
		expect(tokens([...entries, ...entries], [ops])).toBeGreaterThan(tokens(entries, [ops]));
	});

	it("adds nothing for turn markers, which carry no content", () => {
		const spoken = entries.filter((entry) => entry.type !== "turnStart" && entry.type !== "turnEnd");

		expect(tokens(entries, [ops])).toBe(tokens(spoken, [ops]));
	});
});
