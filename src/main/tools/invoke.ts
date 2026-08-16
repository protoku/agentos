import { randomUUID } from "node:crypto";
import { attemptCall } from "./attempt";
import { toolNamed } from "./registry";
import { ensureSandbox } from "./sandbox";
import { appendEntry } from "../storage/conversationFile";
import { conversationFile } from "../storage/workspaceStore";
import { awaitRuling, forget } from "../turns/decisions";
import type { EntrySink } from "../turns/run";
import type { ToolCall } from "../../shared/types";

/** A user call occupies the conversation exactly as a turn does, until it settles. */
const occupied = new Set<string>();

export function isCallRunning(conversationId: string): boolean {
	return occupied.has(conversationId);
}

/**
 * A user-invoked call: no agentId, no turnId, no reason, and permissions do not apply.
 * It is shown while it runs so it can be canceled, and written once it is final.
 */
export async function invokeTool(
	root: string,
	workspaceId: string,
	conversationId: string,
	toolId: string,
	input: Record<string, unknown>,
	emit: EntrySink,
): Promise<ToolCall> {
	const createdAt = new Date().toISOString();
	const call: ToolCall = { type: "toolCall", id: randomUUID(), toolId, input, status: "running", createdAt };
	occupied.add(conversationId);

	try {
		const tool = await toolNamed(root, workspaceId, toolId);
		// The record points at the tool itself, not at the name it happened to be called by.
		call.toolId = tool.id;

		const sandbox = await ensureSandbox(root, workspaceId, conversationId);
		const stopping = awaitRuling(call.id, conversationId);
		const attempt = attemptCall(tool, input, { root, workspaceId, conversationId, sandbox });
		emit({ ...call });

		const stopped = await Promise.race([attempt.then(() => false), stopping.then(() => true)]);
		forget(call.id);

		if (stopped) {
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
	} finally {
		occupied.delete(conversationId);
	}

	call.completedAt = new Date().toISOString();
	await appendEntry(conversationFile(root, workspaceId, conversationId), call);
	emit({ ...call });

	return call;
}
