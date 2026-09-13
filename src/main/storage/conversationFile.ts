import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Entry, TurnEnd, TurnStart, WorkflowEnd, WorkflowStart } from "../../shared/types";

const interruptionError = "Interrupted by an AgentOS restart.";

/** What a thread may hold. Anything else was written by a version that knew more than this one. */
const kinds = new Set([
	"userMessage",
	"agentMessage",
	"toolCall",
	"turnStart",
	"turnEnd",
	"workflowStart",
	"workflowStep",
	"workflowEnd",
]);

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
		.map((line) => JSON.parse(line) as Entry)
		// A line of a kind this AgentOS no longer knows is skipped, so every reader of the thread agrees.
		.filter((entry) => kinds.has(entry.type));

	// Sorting is stable, which is what leaves equal createdAt in file order.
	return entries.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/**
 * Closes what a crash left open, so a start without an end always means running right now. A run is
 * closed as canceled: nothing failed, the app simply stopped, and no step of it is resumed.
 */
export async function recoverInterruptedTurns(file: string): Promise<(TurnEnd | WorkflowEnd)[]> {
	const entries = await readEntries(file);
	const endedTurns = new Set(
		entries.filter((entry): entry is TurnEnd => entry.type === "turnEnd").map((entry) => entry.turnId),
	);
	const endedRuns = new Set(
		entries.filter((entry): entry is WorkflowEnd => entry.type === "workflowEnd").map((entry) => entry.runId),
	);

	const ends: (TurnEnd | WorkflowEnd)[] = entries
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
		(entry): entry is WorkflowStart => entry.type === "workflowStart" && !endedRuns.has(entry.id),
	)) {
		ends.push({
			type: "workflowEnd",
			id: randomUUID(),
			runId: start.id,
			status: "canceled",
			error: interruptionError,
			createdAt: new Date().toISOString(),
		});
	}

	for (const end of ends) await appendEntry(file, end);

	return ends;
}
