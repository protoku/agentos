import { randomUUID } from "node:crypto";
import { askUserId } from "./askUser";
import { parseInput } from "./define";
import { attemptCall } from "./attempt";
import { show } from "./inflight";
import { toolNamed } from "./registry";
import { ensureSandbox } from "./sandbox";
import { appendEntry } from "../storage/conversationFile";
import { conversationFile } from "../storage/workspaceStore";
import { awaitRuling, forget, type Ruling } from "../turns/decisions";
import type { EntrySink } from "../turns/run";
import type { ToolCall } from "../../shared/types";

/** A user call occupies the conversation exactly as a turn does, until it settles. */
const occupied = new Map<string, Promise<ToolCall>>();

export function isCallRunning(conversationId: string): boolean {
	return occupied.has(conversationId);
}

/** Canceling only asks: the call still has its entry to write, and this waits for that. */
export function whenCallSettles(conversationId: string): Promise<ToolCall> | undefined {
	return occupied.get(conversationId);
}

/**
 * A user-invoked call: no agentId, no turnId, no reason, and permissions do not apply.
 * It is shown while it runs so it can be canceled, and written once it is final.
 */
export function invokeTool(
	root: string,
	workspaceId: string,
	conversationId: string,
	toolId: string,
	input: Record<string, unknown>,
	emit: EntrySink,
): Promise<ToolCall> {
	const call = runCall(root, workspaceId, conversationId, toolId, input, emit).finally(() =>
		occupied.delete(conversationId),
	);
	occupied.set(conversationId, call);

	return call;
}

async function runCall(
	root: string,
	workspaceId: string,
	conversationId: string,
	toolId: string,
	input: Record<string, unknown>,
	emit: EntrySink,
): Promise<ToolCall> {
	const createdAt = new Date().toISOString();
	const call: ToolCall = { type: "toolCall", id: randomUUID(), toolId, input, status: "running", createdAt };

	try {
		const tool = await toolNamed(root, workspaceId, toolId);
		// The record points at the tool itself, not at the name it happened to be called by.
		call.toolId = tool.id;

		const sandbox = await ensureSandbox(root, workspaceId, conversationId);
		const ruling = awaitRuling(call.id, conversationId);

		// A question is not work to be run: the call waits in the thread until it is answered.
		if (tool.id === askUserId) {
			// Nothing runs to check the call, so what it asks is checked before anyone waits on it.
			parseInput(tool, input);
			call.status = "pending";
			show(conversationId, call, emit);
			answered(call, await ruling);
			forget(call.id);

			return await written(root, workspaceId, conversationId, call, emit);
		}

		const stop = new AbortController();
		const attempt = attemptCall(tool, input, { root, workspaceId, conversationId, sandbox, signal: stop.signal });
		call.status = "running";
		show(conversationId, call, emit);

		const stopped = await Promise.race([attempt.then(() => false), ruling.then(() => true)]);
		forget(call.id);

		if (stopped) {
			// Canceling is not just letting go of the result: the work itself stops here.
			stop.abort();
			call.status = "canceled";
		} else {
			const { output, failure } = await attempt;
			if (failure === undefined) {
				call.output = output;
				call.status = "success";
			} else {
				call.error = failure;
				call.status = "error";
			}
		}
	} catch (error) {
		// The sandbox or the tool itself: nothing ran, so the call fails without ever having started.
		call.error = error instanceof Error ? error.message : String(error);
		call.status = "error";
	}

	return written(root, workspaceId, conversationId, call, emit);
}

/** What the user answered is the call's output; anything else at that point is a cancel. */
export function answered(call: ToolCall, ruling: Ruling): void {
	if (ruling.type === "answered") {
		call.output = ruling.answers;
		call.status = "success";
	} else {
		call.status = "canceled";
	}
}

async function written(
	root: string,
	workspaceId: string,
	conversationId: string,
	call: ToolCall,
	emit: EntrySink,
): Promise<ToolCall> {
	call.completedAt = new Date().toISOString();
	await appendEntry(conversationFile(root, workspaceId, conversationId), call);
	show(conversationId, call, emit);

	return call;
}
