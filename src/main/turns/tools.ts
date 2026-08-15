import { randomUUID } from "node:crypto";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { appendEntry } from "../storage/conversationFile";
import { builtinTools, type BuiltinToolImplementation } from "../tools/builtin";
import type { Agent, ToolCall } from "../../shared/types";
import type { EntrySink } from "./run";

const serverName = "agentos";
const reason = z.string().describe("Why you are making this call, in one short sentence.");

export interface CallContext {
	file: string;
	sandbox: string;
	agentId: string;
	turnId: string;
	emit: EntrySink;
}

/** An agent sees exactly the tools it is allowed, each one wrapped so its call lands in the thread. */
export function grantedTools(agent: Agent, context: CallContext) {
	const granted = builtinTools.filter((builtin) => agent.tools[builtin.id] === "allow");

	return {
		server: createSdkMcpServer({
			name: serverName,
			tools: granted.map((builtin) =>
				tool(builtin.name, builtin.description, { ...builtin.input.shape, reason }, (args) =>
					record(builtin, args, context),
				),
			),
		}),
		allowedTools: granted.map((builtin) => `mcp__${serverName}__${builtin.name}`),
	};
}

async function record(
	builtin: BuiltinToolImplementation,
	args: Record<string, unknown>,
	context: CallContext,
): Promise<{ content: [{ type: "text"; text: string }]; isError: boolean }> {
	const { reason: given, ...input } = args;
	const call: ToolCall = {
		type: "toolCall",
		id: randomUUID(),
		agentId: context.agentId,
		turnId: context.turnId,
		toolId: builtin.id,
		reason: String(given),
		input,
		status: "running",
		createdAt: new Date().toISOString(),
	};

	try {
		call.output = await builtin.run(input, context.sandbox);
		call.status = "success";
	} catch (failure) {
		call.error = failure instanceof Error ? failure.message : String(failure);
		call.status = "error";
	}

	call.completedAt = new Date().toISOString();
	await appendEntry(context.file, call);
	context.emit(call);

	return {
		content: [{ type: "text", text: JSON.stringify(call.output ?? call.error) }],
		isError: call.status === "error",
	};
}
