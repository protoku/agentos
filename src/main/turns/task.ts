import { randomUUID } from "node:crypto";
import type { Assignment, TaskEnd, TaskRound, TaskStart, TurnEnd } from "../../shared/types";

/** How a task stops: the director's word, the user's cancel, or the rounds running out. */
interface Ending {
	status: TaskEnd["status"];
	verdict?: string;
	question?: string;
}

/** A task while it runs: what the director has named for the next round, and how it says it ends. */
export interface TaskRun {
	id: string;
	directorId: string;
	next: Assignment[];
	ending?: Ending;
}

/** What the loop needs of the world: a turn, a way to write an entry, and the user's stop. */
export interface TaskHooks {
	takeTurn: (agentId: string) => Promise<TurnEnd>;
	record: (entry: TaskStart | TaskRound | TaskEnd) => Promise<void>;
	canceled: () => boolean;
}

const running = new Map<string, TaskRun>();

/** What the task tools reach: the run their conversation is in, absent when it is in none. */
export function runningTask(conversationId: string): TaskRun | undefined {
	return running.get(conversationId);
}

/**
 * A task is the mention chain kept going: a roster acts in order, the director takes the last turn
 * of every round, and what it names there is the roster of the next one.
 */
export async function runTask(conversationId: string, start: TaskStart, hooks: TaskHooks): Promise<TaskEnd> {
	const task: TaskRun = { id: start.id, directorId: start.directorId, next: [] };
	running.set(conversationId, task);

	try {
		await hooks.record(start);

		return await close(task.id, await rounds(task, start, hooks), hooks);
	} finally {
		running.delete(conversationId);
	}
}

async function rounds(task: TaskRun, start: TaskStart, hooks: TaskHooks): Promise<Ending> {
	let roster = start.roster;

	for (let number = 1; number <= start.rounds; number++) {
		const outcome = await round(task, roster, number, hooks);
		if ("ending" in outcome) return outcome.ending;

		roster = outcome.roster;
	}

	// The cap is not success: the work stays in the thread and the director never said done.
	return { status: "exhausted" };
}

async function round(
	task: TaskRun,
	roster: Assignment[],
	number: number,
	hooks: TaskHooks,
): Promise<{ ending: Ending } | { roster: Assignment[] }> {
	await hooks.record({ type: "taskRound", id: randomUUID(), taskId: task.id, number, roster, createdAt: now() });
	task.next = [];
	task.ending = undefined;

	// A failed turn ends the round rather than the task: whoever had not acted opens the next one.
	let carried: Assignment[] = [];
	for (const [index, assignment] of roster.entries()) {
		const end = await hooks.takeTurn(assignment.agentId);
		if (stopped(end, hooks)) return { ending: { status: "canceled" } };
		if (end.status === "failed") {
			carried = roster.slice(index + 1);
			break;
		}
	}

	const judged = await hooks.takeTurn(task.directorId);
	if (stopped(judged, hooks)) return { ending: { status: "canceled" } };
	// A director whose own turn failed judged nothing, so the next round is its to take again.
	if (judged.status === "failed") return { roster: carried };

	if (task.ending !== undefined) return { ending: task.ending };
	// Silence is not done: a director that named nobody, with nobody left to act, has run out.
	if (task.next.length === 0 && carried.length === 0) return { ending: { status: "exhausted" } };

	return { roster: [...carried, ...task.next] };
}

async function close(taskId: string, ending: Ending, hooks: TaskHooks): Promise<TaskEnd> {
	const end: TaskEnd = {
		type: "taskEnd",
		id: randomUUID(),
		taskId,
		status: ending.status,
		...(ending.verdict !== undefined && { verdict: ending.verdict }),
		...(ending.question !== undefined && { question: ending.question }),
		createdAt: now(),
	};
	await hooks.record(end);

	return end;
}

/** The user's stop reaches the loop two ways: the turn it hit, and the cancel it was asked for. */
function stopped(end: TurnEnd, hooks: TaskHooks): boolean {
	return end.status === "canceled" || hooks.canceled();
}

function now(): string {
	return new Date().toISOString();
}
