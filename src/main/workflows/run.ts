import { randomUUID } from "node:crypto";
import { parseDefinition, type Step } from "./definition";
import { resolve, type Results } from "./steps";
import { appendEntry } from "../storage/conversationFile";
import { conversationFile } from "../storage/workspaceStore";
import { invokeTool } from "../tools/invoke";
import { cancelRulings } from "../turns/decisions";
import type { EntrySink } from "../turns/run";
import type { Workflow, WorkflowEnd, WorkflowStep } from "../../shared/types";

interface Run {
	canceled: boolean;
	settled?: Promise<void>;
}

/** A run holds its conversation the way a turn does, and for the same reason. */
const runs = new Map<string, Run>();

export function isWorkflowRunning(conversationId: string): boolean {
	return runs.has(conversationId);
}

export function whenWorkflowSettles(conversationId: string): Promise<void> | undefined {
	return runs.get(conversationId)?.settled;
}

/**
 * Canceling asks the run to stop: the step it is on settles as canceling any call does, and no
 * later step begins. Safe where nothing is running.
 */
export function cancelWorkflow(conversationId: string): void {
	const run = runs.get(conversationId);
	if (run === undefined) return;

	run.canceled = true;
	cancelRulings(conversationId);
}

/** What a run's steps read: what it was started with, and what each step before produced. */
export function runWorkflow(
	root: string,
	workspaceId: string,
	conversationId: string,
	workflow: Workflow,
	input: Record<string, unknown>,
	emit: EntrySink,
): Promise<void> {
	const run: Run = { canceled: false };
	runs.set(conversationId, run);

	run.settled = take(root, workspaceId, conversationId, workflow, input, emit, run).finally(() =>
		runs.delete(conversationId),
	);

	return run.settled;
}

async function take(
	root: string,
	workspaceId: string,
	conversationId: string,
	workflow: Workflow,
	input: Record<string, unknown>,
	emit: EntrySink,
	run: Run,
): Promise<void> {
	const file = conversationFile(root, workspaceId, conversationId);
	const write = async (entry: WorkflowStep | WorkflowEnd | Parameters<EntrySink>[0]) => {
		await appendEntry(file, entry);
		emit(entry);
	};

	const runId = randomUUID();
	await write({
		type: "workflowStart",
		id: runId,
		workflowId: workflow.id,
		name: workflow.name,
		input,
		createdAt: now(),
	});

	const results: Results = { input };
	let ending: Omit<WorkflowEnd, "type" | "id" | "runId" | "createdAt"> = { status: "done" };

	try {
		for (const step of parseDefinition(workflow.definition).steps) {
			if (run.canceled) {
				ending = { status: "canceled", stepId: step.id };
				break;
			}

			const failure = await taken(root, workspaceId, conversationId, runId, step, results, emit, write);
			if (run.canceled) {
				ending = { status: "canceled", stepId: step.id };
				break;
			}
			if (failure !== undefined) {
				ending = { status: "failed", stepId: step.id, error: failure };
				break;
			}
		}
	} catch (failure) {
		ending = { status: "failed", error: failure instanceof Error ? failure.message : String(failure) };
	}

	await write({ type: "workflowEnd", id: randomUUID(), runId, ...ending, createdAt: now() });
}

/** One step, announced before it runs, since what it is about to do is what the thread should say. */
async function taken(
	root: string,
	workspaceId: string,
	conversationId: string,
	runId: string,
	step: Step,
	results: Results,
	emit: EntrySink,
	write: (entry: WorkflowStep) => Promise<void>,
): Promise<string | undefined> {
	const runInput = step.input === undefined ? {} : (resolve(step.input, results) as Record<string, unknown>);

	await write({
		type: "workflowStep",
		id: randomUUID(),
		runId,
		stepId: step.id,
		...(step.tool !== undefined && { tool: step.tool, input: runInput }),
		...(step.agent !== undefined && { agent: step.agent }),
		createdAt: now(),
	});

	if (step.tool === undefined) return `${step.id} names an agent, which this AgentOS cannot run yet`;

	const call = await invokeTool(root, workspaceId, conversationId, step.tool, runInput, emit);
	if (call.status !== "success") return call.error ?? `${step.id} did not finish`;

	results[step.id] = call.output ?? {};

	return undefined;
}

function now(): string {
	return new Date().toISOString();
}
