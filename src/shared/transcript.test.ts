import { describe, expect, it } from "vitest";
import { estimateTokens, sinceSummary, spentOn, tokens, transcript } from "./transcript";
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

describe("spentOn", () => {
	const ended = (spent?: {
		sent: number;
		cached: number;
		received: number;
		usd: number;
		requests?: number;
	}): Entry => ({
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

	it("leaves out a turn recorded with zeros, including its request", () => {
		const entries = [
			ended({ sent: 1000, cached: 800, received: 120, usd: 0.01, requests: 1 }),
			ended({ sent: 0, cached: 0, received: 0, usd: 0, requests: 1 }),
		];

		expect(spentOn(entries)).toEqual({ sent: 1000, cached: 800, received: 120, usd: 0.01, requests: 1 });
	});

	it("costs nothing when nothing has happened", () => {
		expect(spentOn([])).toEqual({ sent: 0, cached: 0, received: 0, usd: 0 });
	});

	it("adds up the requests, once any turn has counted them", () => {
		const entries = [
			ended({ sent: 1000, cached: 800, received: 120, usd: 0.01, requests: 1 }),
			ended({ sent: 2000, cached: 1900, received: 80, usd: 0.02, requests: 12 }),
		];

		expect(spentOn(entries).requests).toBe(13);
	});

	it("says nothing about requests where no turn counted them", () => {
		const entries = [ended({ sent: 1000, cached: 800, received: 120, usd: 0.01 })];

		expect(spentOn(entries).requests).toBeUndefined();
	});
});

describe("summaries", () => {
	const summarized: Entry[] = [
		...entries,
		{ type: "userMessage", id: "m3", mentions: [ops.id], summarize: true, content: "@ops keep the deploy", createdAt: "" },
		{ type: "turnStart", id: "t2", agentId: ops.id, createdAt: "" },
		{ type: "summary", id: "s1", agentId: ops.id, turnId: "t2", content: "Deployed a.txt", createdAt: "" },
		{ type: "turnEnd", id: "e2", turnId: "t2", status: "finished", createdAt: "" },
		{ type: "userMessage", id: "m4", content: "next service", createdAt: "" },
	];

	it("asks the summarizing agent for a summary, in the words of the request", () => {
		const text = transcript(entries.concat(summarized.slice(5, 7)), [ops], ops);

		expect(text).toContain("user asks for a summary, written with write_summary");
		expect(text).toContain("@ops keep the deploy");
	});

	it("sends later turns the latest summary and what follows it, and nothing before", () => {
		const text = transcript(summarized, [ops], ops);

		expect(text).toContain("summary of the conversation before this point, by @ops:\nDeployed a.txt");
		expect(text).toContain("user: next service");
		expect(text).not.toContain("@ops deploy");
		expect(text).not.toContain("keep the deploy");
	});

	it("counts the size from the latest summary on, so it drops once one is written", () => {
		expect(tokens(summarized, [ops])).toBeLessThan(tokens(summarized.slice(0, 7), [ops]));
		expect(tokens(summarized, [ops])).toBe(tokens(summarized.slice(7), [ops]));
	});

	it("chains, reading from the latest summary only", () => {
		const again: Entry[] = [
			...summarized,
			{ type: "summary", id: "s2", agentId: ops.id, turnId: "t3", content: "Two done", createdAt: "" },
		];

		expect(sinceSummary(again).map((entry) => entry.id)).toEqual(["s2"]);
		expect(sinceSummary(entries)).toEqual(entries);
	});
});
