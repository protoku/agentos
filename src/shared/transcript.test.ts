import { describe, expect, it } from "vitest";
import { estimateTokens, spentOn, tokens, transcript } from "./transcript";
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

const editor: Agent = {
	id: "agent-editor",
	name: "editor",
	createdAt: "2026-08-15T10:00:00.000Z",
	model: "claude-opus-5",
	systemPrompt: "You judge what a round produced.",
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

	it("says what a task asked for, of whom, and how it ended", () => {
		const task: Entry[] = [
			{
				type: "taskStart",
				id: "k1",
				directorId: editor.id,
				goal: "Write the launch note",
				roster: [{ agentId: ops.id, ask: "draft the note", criterion: "reads in one minute" }],
				rounds: 6,
				createdAt: "",
			},
			{
				type: "taskRound",
				id: "r1",
				taskId: "k1",
				number: 1,
				roster: [{ agentId: ops.id, ask: "draft the note", criterion: "reads in one minute" }],
				createdAt: "",
			},
			{ type: "taskEnd", id: "k2", taskId: "k1", status: "done", verdict: "It reads", createdAt: "" },
		];

		const text = transcript(task, [ops, editor], ops);

		expect(text).toContain("user started a task, directed by @editor, at most 6 rounds: Write the launch note");
		expect(text).toContain("round 1 of the task:");
		expect(text).toContain("- @ops is asked to draft the note, judged by: reads in one minute");
		expect(text).toContain("the task ended as done: It reads");
	});

	it("carries the question a blocked task stopped on", () => {
		const blocked: Entry[] = [
			{
				type: "taskEnd",
				id: "k3",
				taskId: "k1",
				status: "blocked",
				question: "Which release is this for?",
				createdAt: "",
			},
		];

		expect(transcript(blocked, [ops], ops)).toContain(
			"the task ended as blocked, and the question is: Which release is this for?",
		);
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

describe("spentOn", () => {
	const ended = (spent?: { sent: number; cached: number; received: number; usd: number }): Entry => ({
		type: "turnEnd",
		id: `end-${spent?.sent ?? 0}`,
		turnId: "turn-1",
		status: "finished",
		...(spent !== undefined && { spent }),
		createdAt: "2026-08-15T10:00:00.000Z",
	});

	it("adds up what the turns reported", () => {
		const entries = [
			ended({ sent: 1000, cached: 800, received: 120, usd: 0.01 }),
			ended({ sent: 2000, cached: 1900, received: 80, usd: 0.02 }),
		];

		expect(spentOn(entries)).toEqual({ sent: 3000, cached: 2700, received: 200, usd: 0.03 });
	});

	it("counts a turn that reported nothing as nothing", () => {
		expect(spentOn([ended()])).toEqual({ sent: 0, cached: 0, received: 0, usd: 0 });
	});

	it("costs nothing when nothing has happened", () => {
		expect(spentOn([])).toEqual({ sent: 0, cached: 0, received: 0, usd: 0 });
	});
});
