import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Entry, TaskEnd, TaskStart, TurnEnd, TurnStart } from "../../shared/types";

const interruptionError = "Interrupted by an AgentOS restart.";

/** Only ever call this with a final entry: a line, once written, is never touched again. */
export async function appendEntry(file: string, entry: Entry): Promise<void> {
	await mkdir(dirname(file), { recursive: true });
	await appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
}

export async function readEntries(file: string): Promise<Entry[]> {
	let text: string;
	try {
		text = await readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}

	const entries = text
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as Entry);

	// Sorting is stable, which is what leaves equal createdAt in file order.
	return entries.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/**
 * Closes what a crash left open, so a start without an end always means running right now. A task
 * is closed with the turn it was interrupted in, since the loop that would have ended it is gone.
 */
export async function recoverInterruptedTurns(file: string): Promise<(TurnEnd | TaskEnd)[]> {
	const entries = await readEntries(file);
	const endedTurns = new Set(
		entries.filter((entry): entry is TurnEnd => entry.type === "turnEnd").map((entry) => entry.turnId),
	);
	const endedTasks = new Set(
		entries.filter((entry): entry is TaskEnd => entry.type === "taskEnd").map((entry) => entry.taskId),
	);

	const ends: (TurnEnd | TaskEnd)[] = entries
		.filter((entry): entry is TurnStart => entry.type === "turnStart" && !endedTurns.has(entry.id))
		.map<TurnEnd>((start) => ({
			type: "turnEnd",
			id: randomUUID(),
			turnId: start.id,
			status: "failed",
			error: interruptionError,
			createdAt: new Date().toISOString(),
		}));

	for (const start of entries.filter(
		(entry): entry is TaskStart => entry.type === "taskStart" && !endedTasks.has(entry.id),
	)) {
		ends.push({
			type: "taskEnd",
			id: randomUUID(),
			taskId: start.id,
			status: "canceled",
			error: interruptionError,
			createdAt: new Date().toISOString(),
		});
	}

	for (const end of ends) await appendEntry(file, end);

	return ends;
}
