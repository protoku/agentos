import { randomUUID } from "node:crypto";
import { builtinTool } from "./builtin";
import { ensureSandbox } from "./sandbox";
import { appendEntry } from "../storage/conversationFile";
import { conversationFile } from "../storage/workspaceStore";
import type { ToolCall } from "../../shared/types";

/**
 * A user-invoked call: no agentId, no turnId, no reason, and permissions do not apply.
 * The entry reaches the thread once, when it is already final.
 */
export async function invokeTool(
	root: string,
	workspaceId: string,
	conversationId: string,
	toolId: string,
	input: Record<string, unknown>,
): Promise<ToolCall> {
	const createdAt = new Date().toISOString();
	const call: ToolCall = { type: "toolCall", id: randomUUID(), toolId, input, status: "running", createdAt };

	try {
		const sandbox = await ensureSandbox(root, workspaceId, conversationId);
		call.output = await builtinTool(toolId).run(input, sandbox);
		call.status = "success";
	} catch (error) {
		call.error = error instanceof Error ? error.message : String(error);
		call.status = "error";
	}

	call.completedAt = new Date().toISOString();
	await appendEntry(conversationFile(root, workspaceId, conversationId), call);

	return call;
}
