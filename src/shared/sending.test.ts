import { describe, expect, it } from "vitest";
import { actedHere, granted, sending } from "./sending";
import type { Agent, Entry, Memory, Tool } from "./types";

const dev: Agent = {
	id: "agent-dev",
	name: "dev",
	createdAt: "2026-01-01T00:00:00.000Z",
	model: "claude-opus-5",
	systemPrompt: "You implement changes in the repository mounted in this conversation's sandbox.",
	tools: { "tool-read": "allow", "tool-write": "ask", "tool-push": "deny" },
	carries: ["repo"],
};

const reviewer: Agent = { ...dev, id: "agent-review", name: "review", tools: {}, carries: [] };

const tools: Tool[] = [
	{
		type: "builtin",
		id: "tool-read",
		name: "read_file",
		description: "Read a file.",
		inputSchema: { type: "object", properties: { path: { type: "string" } } },
		outputSchema: {},
	},
	{
		type: "builtin",
		id: "tool-write",
		name: "write_file",
		description: "Create a file, replacing it if it already exists, which is a much longer description.",
		inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } },
		outputSchema: {},
	},
	{
		type: "builtin",
		id: "tool-push",
		name: "git_push",
		description: "Push a git mount's branch to the remote.",
		inputSchema: { type: "object", properties: { path: { type: "string" } } },
		outputSchema: {},
	},
];

const memories: Memory[] = [
	{
		id: "memory-1",
		title: "Where the spec lives",
		body: "The repository keeps its behaviour spec in docs/overview.md.",
		tags: ["repo"],
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	},
	{
		id: "memory-2",
		title: "Carried by nobody",
		body: "Nobody carries this one.",
		tags: ["elsewhere"],
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	},
];

const turn: Entry[] = [
	{ type: "userMessage", id: "m1", content: "@dev hello", createdAt: "2026-01-01T00:00:01.000Z" },
	{ type: "turnStart", id: "t1", agentId: "agent-dev", createdAt: "2026-01-01T00:00:02.000Z" },
	{
		type: "turnEnd",
		id: "e1",
		turnId: "t1",
		status: "finished",
		spent: { sent: 24_100, cached: 0, received: 100, usd: 0.235, requests: 1 },
		createdAt: "2026-01-01T00:00:03.000Z",
	},
];

/** The same turn, having cost something else, which is what the measurement lines turn on. */
function withSpend(spent: Extract<Entry, { type: "turnEnd" }>["spent"]): Entry[] {
	return [turn[1], { ...(turn[2] as Extract<Entry, { type: "turnEnd" }>), spent }];
}

function partNamed(entries: Entry[], name: string) {
	return sending(entries, [dev], tools, memories, dev).parts.find((part) => part.name === name);
}

describe("sending", () => {
	it("prices the prompt, the carried memories, each granted tool and the thread", () => {
		const what = sending(turn, [dev], tools, memories, dev);

		expect(what.parts.map((part) => part.kind)).toEqual(["prompt", "memories", "tool", "tool", "thread"]);
		expect(what.estimated).toBe(what.parts.reduce((total, part) => total + part.tokens, 0));
		expect(what.parts.every((part) => part.tokens > 0)).toBe(true);
	});

	it("leaves out a tool the agent may not use", () => {
		expect(partNamed(turn, "git_push")).toBeUndefined();
		expect(partNamed(turn, "read_file")).toBeDefined();
	});

	it("puts the heaviest tool first, since that is where trimming starts", () => {
		const held = sending(turn, [dev], tools, memories, dev).parts.filter((part) => part.kind === "tool");

		expect(held.map((part) => part.name)).toEqual(["write_file", "read_file"]);
	});

	it("carries only the memories the agent's tags name", () => {
		const both = { ...dev, carries: ["repo", "elsewhere"] };
		const one = partNamed(turn, "Carried memory");
		const two = sending(turn, [both], tools, memories, both).parts.find((part) => part.kind === "memories");

		expect(one?.tokens).toBeGreaterThan(0);
		expect(two?.name).toBe("Carried memories");
		expect(two?.tokens).toBeGreaterThan(one?.tokens ?? 0);
	});

	it("says nothing about memories when the agent carries none", () => {
		const what = sending(turn, [reviewer], tools, memories, reviewer);

		expect(what.parts.some((part) => part.kind === "memories")).toBe(false);
	});

	it("sets the measurement against the estimate when the turn was one request", () => {
		const what = sending(turn, [dev], tools, memories, dev);

		expect(what).toMatchObject({ measured: 24_100, requests: 1 });
		expect(what.unaccounted).toBe(24_100 - what.estimated);
	});

	it("will not compare a turn that asked the model more than once", () => {
		const long = withSpend({ sent: 1_400_000, cached: 1_300_000, received: 9000, usd: 12, requests: 31 });
		const what = sending(long, [dev], tools, memories, dev);

		expect(what).toMatchObject({ measured: 1_400_000, requests: 31 });
		expect(what.unaccounted).toBeUndefined();
	});

	it("will not compare a turn that never recorded how many requests it made", () => {
		const old = withSpend({ sent: 24_100, cached: 0, received: 100, usd: 0.235 });
		const what = sending(old, [dev], tools, memories, dev);

		expect(what.measured).toBe(24_100);
		expect(what.requests).toBeUndefined();
		expect(what.unaccounted).toBeUndefined();
	});

	it("measures nothing when this agent has not finished a turn here", () => {
		const what = sending(turn, [reviewer], tools, memories, reviewer);

		expect(what.measured).toBeUndefined();
		expect(what.unaccounted).toBeUndefined();
	});

	it("never reports a negative remainder, since an estimate can overshoot", () => {
		const cheap = withSpend({ sent: 1, cached: 0, received: 1, usd: 0, requests: 1 });

		expect(sending(cheap, [dev], tools, memories, dev).unaccounted).toBe(0);
	});
});

describe("granted", () => {
	it("treats denied as unlisted", () => {
		expect(granted(tools, dev).map((tool) => tool.name)).toEqual(["read_file", "write_file"]);
		expect(granted(tools, reviewer)).toEqual([]);
	});
});

describe("actedHere", () => {
	it("names whoever acted last first, and each of them once", () => {
		const both: Entry[] = [
			{ type: "turnStart", id: "t1", agentId: "agent-dev", createdAt: "2026-01-01T00:00:02.000Z" },
			{ type: "turnStart", id: "t2", agentId: "agent-review", createdAt: "2026-01-01T00:00:04.000Z" },
			{ type: "turnStart", id: "t3", agentId: "agent-dev", createdAt: "2026-01-01T00:00:06.000Z" },
		];

		expect(actedHere(both, [dev, reviewer]).map((agent) => agent.name)).toEqual(["dev", "review"]);
	});

	it("names nobody in a conversation where no turn has started", () => {
		expect(actedHere([turn[0]], [dev, reviewer])).toEqual([]);
	});
});
