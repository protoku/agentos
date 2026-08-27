import { describe, expect, it } from "vitest";
import { runningTask, runTask, type TaskHooks, type TaskRun } from "./task";
import type { Assignment, Entry, TaskStart, TurnEnd } from "../../shared/types";

const conversationId = "conversation-1";

/** What the task tools would reach from the director's turn, which is where these tests stand. */
function acting(): TaskRun {
	const task = runningTask(conversationId);
	if (task === undefined) throw new Error("No task is running");

	return task;
}

function asks(agentId: string, ask = "write it"): Assignment {
	return { agentId, ask, criterion: "it reads in one minute" };
}

function started(roster: Assignment[], rounds: number): TaskStart {
	return {
		type: "taskStart",
		id: "task-1",
		directorId: "director",
		goal: "Write the launch note",
		roster,
		rounds,
		createdAt: "2026-08-15T10:00:00.000Z",
	};
}

/**
 * The director acts through the run the task tools reach, which is what this drives directly:
 * a turn is whatever the agent did, and for the director that is what it named before finishing.
 */
function driven(turns: Record<string, TurnEnd["status"]>, acted: (agentId: string, round: number) => void) {
	const took: string[] = [];
	const entries: Entry[] = [];
	let round = 0;

	const hooks: TaskHooks = {
		takeTurn: (agentId) => {
			took.push(agentId);
			acted(agentId, round);

			return Promise.resolve(end(turns[`${agentId}-${took.length}`] ?? turns[agentId] ?? "finished"));
		},
		record: (entry) => {
			if (entry.type === "taskRound") round = entry.number;
			entries.push(entry);

			return Promise.resolve();
		},
		canceled: () => false,
	};

	return { hooks, took, entries };
}

function end(status: TurnEnd["status"]): TurnEnd {
	return { type: "turnEnd", id: "end-1", turnId: "turn-1", status, createdAt: "2026-08-15T10:00:00.000Z" };
}

describe("runTask", () => {
	it("runs the roster in order and gives the director the last turn of every round", async () => {
		const { hooks, took } = driven({}, (agentId, round) => {
			if (agentId !== "director") return;

			if (round === 1) acting().next.push(asks("writer", "revise it"));
			else acting().ending = { status: "done", verdict: "It reads" };
		});

		const ended = await runTask(conversationId, started([asks("writer"), asks("proofreader")], 6), hooks);

		expect(took).toEqual(["writer", "proofreader", "director", "writer", "director"]);
		expect(ended.status).toBe("done");
		expect(ended.verdict).toBe("It reads");
	});

	it("writes the start, every round with its roster, and the end", async () => {
		const { hooks, entries } = driven({}, (agentId) => {
			if (agentId === "director") acting().ending = { status: "done", verdict: "It reads" };
		});

		await runTask(conversationId, started([asks("writer")], 6), hooks);

		expect(entries.map((entry) => entry.type)).toEqual(["taskStart", "taskRound", "taskEnd"]);
		expect(entries[1]).toMatchObject({ taskId: "task-1", number: 1, roster: [asks("writer")] });
	});

	it("ends blocked on the question the director could not answer itself", async () => {
		const { hooks } = driven({}, (agentId) => {
			if (agentId === "director") acting().ending = { status: "blocked", question: "Which release?" };
		});

		const ended = await runTask(conversationId, started([asks("writer")], 6), hooks);

		expect(ended).toMatchObject({ status: "blocked", question: "Which release?" });
	});

	it("ends exhausted at the round cap, which is not success", async () => {
		const { hooks, took } = driven({}, (agentId) => {
			if (agentId === "director") acting().next.push(asks("writer"));
		});

		const ended = await runTask(conversationId, started([asks("writer")], 3), hooks);

		expect(ended.status).toBe("exhausted");
		expect(took).toHaveLength(6);
	});

	it("ends exhausted when the director names nobody and closes nothing", async () => {
		const { hooks, took } = driven({}, () => {});

		const ended = await runTask(conversationId, started([asks("writer")], 6), hooks);

		expect(ended.status).toBe("exhausted");
		expect(took).toEqual(["writer", "director"]);
	});

	it("ends canceled the moment a turn is stopped, and takes no turn after it", async () => {
		const { hooks, took } = driven({ writer: "canceled" }, () => {});

		const ended = await runTask(conversationId, started([asks("writer"), asks("proofreader")], 6), hooks);

		expect(ended.status).toBe("canceled");
		expect(took).toEqual(["writer"]);
	});

	it("lets a failed turn end its round, and opens the next one with whoever never acted", async () => {
		const { hooks, took } = driven({ "writer-1": "failed" }, (agentId, round) => {
			if (agentId !== "director") return;

			if (round === 1) acting().next.push(asks("editor"));
			else acting().ending = { status: "done", verdict: "It reads" };
		});

		const ended = await runTask(conversationId, started([asks("writer"), asks("proofreader")], 6), hooks);

		// The proofreader never acted, so it opens the next round, ahead of what the director added.
		expect(took).toEqual(["writer", "director", "proofreader", "editor", "director"]);
		expect(ended.status).toBe("done");
	});

	it("gives the round back to a director whose own turn failed", async () => {
		const { hooks, took } = driven({ "director-2": "failed" }, (agentId, round) => {
			if (agentId === "director" && round === 2) acting().ending = { status: "done", verdict: "It reads" };
		});

		const ended = await runTask(conversationId, started([asks("writer")], 6), hooks);

		expect(took).toEqual(["writer", "director", "director"]);
		expect(ended.status).toBe("done");
	});

	it("leaves no running task behind once it has ended", async () => {
		const { hooks } = driven({}, (agentId) => {
			if (agentId === "director") expect(runningTask(conversationId)?.id).toBe("task-1");
		});

		await runTask(conversationId, started([asks("writer")], 6), hooks);

		expect(runningTask(conversationId)).toBeUndefined();
	});
});
