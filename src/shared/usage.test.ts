import { describe, expect, it } from "vitest";
import { cachedShare, dayOf, perDay, tally, unknown } from "./usage";
import type { TurnUsage } from "./api";

function turn(given: Partial<TurnUsage> & { usd: number; day: string }): TurnUsage {
	return {
		conversationId: given.conversationId ?? "c1",
		title: given.title ?? "Scratch work",
		createdAt: `${given.day}T12:00:00.000Z`,
		spent: given.spent ?? { sent: 1000, cached: 250, received: 100, usd: given.usd },
		...(given.agentId !== undefined && { agentId: given.agentId }),
		...(given.model !== undefined && { model: given.model }),
	};
}

const turns: TurnUsage[] = [
	turn({ day: "2026-09-10", usd: 1, model: "claude-opus-5", agentId: "a1" }),
	turn({ day: "2026-09-10", usd: 2, model: "claude-opus-5", agentId: "a2" }),
	turn({ day: "2026-09-12", usd: 4, model: "claude-haiku-4-5", agentId: "a1", conversationId: "c2" }),
	turn({ day: "2026-09-12", usd: 8 }),
];

describe("tally", () => {
	it("groups and adds up, dearest first", () => {
		const byModel = tally(turns, (one) => ({ key: one.model ?? unknown, name: one.model ?? unknown }));

		expect(byModel.map((row) => row.key)).toEqual([unknown, "claude-haiku-4-5", "claude-opus-5"]);
		expect(byModel[0]).toMatchObject({ turns: 1, usd: 8 });
		expect(byModel[2]).toMatchObject({ turns: 2, usd: 3, sent: 2000, cached: 500, received: 200 });
	});

	it("keeps a turn whose agent or model the workspace can no longer name", () => {
		const byAgent = tally(turns, (one) => ({ key: one.agentId ?? unknown, name: one.agentId ?? unknown }));

		expect(byAgent.find((row) => row.key === unknown)).toMatchObject({ turns: 1, usd: 8 });
		expect(byAgent.reduce((total, row) => total + row.turns, 0)).toBe(turns.length);
	});

	it("counts nothing as nothing", () => {
		expect(tally([], () => ({ key: "x", name: "x" }))).toEqual([]);
	});
});

describe("perDay", () => {
	it("returns the days asked for, oldest first, with the empty ones kept", () => {
		const days = perDay(turns, 4, new Date("2026-09-13T12:00:00.000Z"));

		expect(days.map((day) => day.day)).toEqual(["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"]);
		expect(days.map((day) => day.usd)).toEqual([3, 0, 12, 0]);
		expect(days[2]).toMatchObject({ turns: 2, sent: 2000 });
	});

	it("leaves out what falls before the window", () => {
		const days = perDay(turns, 2, new Date("2026-09-13T12:00:00.000Z"));

		expect(days.map((day) => day.day)).toEqual(["2026-09-12", "2026-09-13"]);
		expect(days.reduce((total, day) => total + day.usd, 0)).toBe(12);
	});

	it("crosses a month end without losing a day", () => {
		const days = perDay([], 3, new Date("2026-10-01T12:00:00.000Z"));

		expect(days.map((day) => day.day)).toEqual(["2026-09-29", "2026-09-30", "2026-10-01"]);
	});
});

describe("cachedShare", () => {
	it("is what it says, and nothing rather than a division by zero", () => {
		expect(cachedShare({ sent: 1000, cached: 250 })).toBe(0.25);
		expect(cachedShare({ sent: 0, cached: 0 })).toBe(0);
	});
});

describe("dayOf", () => {
	it("pads a single figure, so days sort as text", () => {
		expect(dayOf("2026-01-02T12:00:00.000Z")).toBe("2026-01-02");
	});
});
