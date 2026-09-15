import type { TurnUsage } from "./api";

/** What a set of turns came to, however they were grouped. */
export interface Tally {
	key: string;
	name: string;
	turns: number;
	sent: number;
	cached: number;
	received: number;
	usd: number;
}

/** A day and what it cost, whether or not anything happened in it. */
export interface Day {
	day: string;
	turns: number;
	sent: number;
	usd: number;
}

/** What a turn whose agent or model the workspace can no longer name is counted as. */
export const unknown = "unknown";

/** Grouped by whatever the caller names them by, dearest first, since that is what is looked at. */
export function tally(turns: TurnUsage[], naming: (turn: TurnUsage) => { key: string; name: string }): Tally[] {
	const tallies = new Map<string, Tally>();

	for (const turn of turns) {
		const { key, name } = naming(turn);
		const running = tallies.get(key) ?? { key, name, turns: 0, sent: 0, cached: 0, received: 0, usd: 0 };

		tallies.set(key, {
			...running,
			turns: running.turns + 1,
			sent: running.sent + turn.spent.sent,
			cached: running.cached + turn.spent.cached,
			received: running.received + turn.spent.received,
			usd: running.usd + turn.spent.usd,
		});
	}

	return [...tallies.values()].sort((first, second) => second.usd - first.usd);
}

/**
 * The last so many days, oldest first, with the empty ones kept: a gap in the middle of a chart
 * says something, and dropping it would draw a quiet week as a busy one.
 */
export function perDay(turns: TurnUsage[], days: number, today = new Date()): Day[] {
	const running = new Map<string, Day>();

	for (const turn of turns) {
		const day = dayOf(turn.createdAt);
		const held = running.get(day) ?? { day, turns: 0, sent: 0, usd: 0 };

		running.set(day, {
			day,
			turns: held.turns + 1,
			sent: held.sent + turn.spent.sent,
			usd: held.usd + turn.spent.usd,
		});
	}

	const wanted: Day[] = [];
	for (let back = days - 1; back >= 0; back--) {
		const when = new Date(today);
		when.setDate(when.getDate() - back);

		const day = dayOf(when.toISOString());
		wanted.push(running.get(day) ?? { day, turns: 0, sent: 0, usd: 0 });
	}

	return wanted;
}

/** How much of what was sent the model had already cached, which is what a cheap turn looks like. */
export function cachedShare(tally: Pick<Tally, "sent" | "cached">): number {
	return tally.sent === 0 ? 0 : tally.cached / tally.sent;
}

/** The day a turn belongs to is the day the person at the keyboard had, not the one in UTC. */
export function dayOf(iso: string): string {
	const when = new Date(iso);
	const month = `${when.getMonth() + 1}`.padStart(2, "0");
	const date = `${when.getDate()}`.padStart(2, "0");

	return `${when.getFullYear()}-${month}-${date}`;
}
