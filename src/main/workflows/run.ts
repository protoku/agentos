import { randomUUID } from "node:crypto";
import { parseDefinition, type Step } from "./definition";
import { resolve, type Results } from "./steps";
import { appendEntry } from "../storage/conversationFile";
import { asking, declared, resultTools } from "./result";
import { zodObjectFrom } from "../tools/schema";
import { invokeTool } from "../tools/invoke";
import { runTurnFor } from "../turns/run";
import { conversationFile, loadWorkspace } from "../storage/workspaceStore";
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
		...(step.agent !== undefined && { agent: step.agent, ask: String(resolve(step.ask ?? "", results)) }),
		createdAt: now(),
	});

	if (step.agent !== undefined) return await asked(root, workspaceId, conversationId, step, results, emit);

	const call = await invokeTool(root, workspaceId, conversationId, step.tool as string, runInput, emit);
	if (call.status !== "success") return call.error ?? `${step.id} did not finish`;

	results[step.id] = call.output ?? {};

	return undefined;
}

/**
 * An agent step is an ordinary turn. The agent reads what it was asked for in the step entry, which
 * is already in the thread, and where the step declares a result it is lent the tool to hand one back.
 */
async function asked(
	root: string,
	workspaceId: string,
	conversationId: string,
	step: Step,
	results: Results,
	emit: EntrySink,
): Promise<string | undefined> {
	const workspace = await loadWorkspace(root, workspaceId);
	const agent = workspace.agents.find((candidate) => candidate.name === step.agent);
	if (agent === undefined) return `No agent ${step.agent}`;

	const wanted = step.result !== undefined;
	if (wanted) asking(conversationId);

	const end = await runTurnFor(root, workspaceId, conversationId, agent.id, emit, wanted ? resultTools : []);
	const result = declared(conversationId);

	if (end.status !== "finished") return end.error ?? `@${agent.name} did not finish this step`;
	if (!wanted) return undefined;
	if (result === undefined) return `@${agent.name} ended the step without declaring what it was asked for`;

	try {
		results[step.id] = zodObjectFrom({ properties: step.result }).parse(result);
	} catch {
		return `@${agent.name} declared something the step did not ask for`;
	}

	return undefined;
}

function now(): string {
	return new Date().toISOString();
}
