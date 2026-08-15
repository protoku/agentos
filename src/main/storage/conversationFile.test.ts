import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendEntry, readEntries, recoverInterruptedTurns } from "./conversationFile";
import type { TurnEnd, TurnStart, UserMessage } from "../../shared/types";

let directory: string;
let file: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "agentos-"));
	file = join(directory, "conversations", "c1.jsonl");
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

function message(id: string, createdAt: string): UserMessage {
	return { type: "userMessage", id, content: id, createdAt };
}

function turnStart(id: string, createdAt: string): TurnStart {
	return { type: "turnStart", id, agentId: "agent-1", createdAt };
}

function turnEnd(turnId: string, createdAt: string): TurnEnd {
	return { type: "turnEnd", id: `end-${turnId}`, turnId, status: "finished", createdAt };
}

describe("appendEntry", () => {
	it("writes one line per entry and leaves earlier lines untouched", async () => {
		await appendEntry(file, message("m1", "2026-08-15T10:00:00.000Z"));
		const afterFirst = await readFile(file, "utf8");
		await appendEntry(file, message("m2", "2026-08-15T10:00:01.000Z"));
		const afterSecond = await readFile(file, "utf8");

		expect(afterSecond.startsWith(afterFirst)).toBe(true);
		expect(afterSecond.trimEnd().split("\n")).toHaveLength(2);
	});
});

describe("readEntries", () => {
	it("returns an empty thread when the file does not exist yet", async () => {
		expect(await readEntries(file)).toEqual([]);
	});

	it("orders by createdAt, not by write order", async () => {
		await appendEntry(file, message("later", "2026-08-15T10:00:02.000Z"));
		await appendEntry(file, message("earlier", "2026-08-15T10:00:01.000Z"));

		expect((await readEntries(file)).map((entry) => entry.id)).toEqual(["earlier", "later"]);
	});

	it("breaks ties on equal createdAt with file order", async () => {
		await appendEntry(file, message("first", "2026-08-15T10:00:00.000Z"));
		await appendEntry(file, message("second", "2026-08-15T10:00:00.000Z"));
		await appendEntry(file, message("third", "2026-08-15T10:00:00.000Z"));

		expect((await readEntries(file)).map((entry) => entry.id)).toEqual(["first", "second", "third"]);
	});
});

describe("recoverInterruptedTurns", () => {
	it("closes a turn whose start has no end", async () => {
		await appendEntry(file, turnStart("t1", "2026-08-15T10:00:00.000Z"));

		const ends = await recoverInterruptedTurns(file);

		expect(ends).toHaveLength(1);
		expect(ends[0]).toMatchObject({
			type: "turnEnd",
			turnId: "t1",
			status: "failed",
			error: "Interrupted by an AgentOS restart.",
		});
		expect(await readEntries(file)).toHaveLength(2);
	});

	it("leaves a thread of finished turns untouched", async () => {
		await appendEntry(file, turnStart("t1", "2026-08-15T10:00:00.000Z"));
		await appendEntry(file, turnEnd("t1", "2026-08-15T10:00:01.000Z"));

		expect(await recoverInterruptedTurns(file)).toEqual([]);
		expect(await readEntries(file)).toHaveLength(2);
	});

	it("has nothing left to close when it runs again", async () => {
		await appendEntry(file, turnStart("t1", "2026-08-15T10:00:00.000Z"));
		await recoverInterruptedTurns(file);

		expect(await recoverInterruptedTurns(file)).toEqual([]);
		expect(await readEntries(file)).toHaveLength(2);
	});
});
