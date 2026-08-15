import { randomUUID } from "node:crypto";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { awaitRuling, forget } from "./decisions";
import { appendEntry } from "../storage/conversationFile";
import { attemptCall } from "../tools/attempt";
import { builtinTools } from "../tools/builtin";
import type { BuiltinToolImplementation, ToolContext } from "../tools/define";
import type { Agent, ToolCall } from "../../shared/types";
import type { EntrySink } from "./run";

const serverName = "agentos";
const reason = z.string().describe("Why you are making this call, in one short sentence.");

export interface CallContext extends ToolContext {
	file: string;
	agentId: string;
	turnId: string;
	emit: EntrySink;
	stopped: () => boolean;
}

/**
 * An agent sees exactly the tools it is granted, each one wrapped so its call lands in the thread.
 * Ask tools are indistinguishable from allowed ones here: the wait for a decision is the only
 * difference, and to the agent that looks like a call still running.
 */
export function grantedTools(agent: Agent, context: CallContext) {
	const granted = builtinTools.filter((builtin) => agent.tools[builtin.id] !== undefined);

	return {
		server: createSdkMcpServer({
			name: serverName,
			tools: granted.map((builtin) =>
				tool(builtin.name, builtin.description, { ...builtin.input.shape, reason }, (args) =>
					record(builtin, agent.tools[builtin.id] === "ask", args, context),
				),
			),
		}),
		allowedTools: granted.map((builtin) => `mcp__${serverName}__${builtin.name}`),
	};
}

async function record(
	builtin: BuiltinToolImplementation,
	asks: boolean,
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
		status: asks ? "pending" : "running",
		createdAt: new Date().toISOString(),
	};

	// A turn stops the moment it is canceled, so a call it asks for after that never runs.
	if (context.stopped()) {
		call.status = "canceled";

		return settle(call, context, "This call was canceled by the user.");
	}

	if (asks) {
		// Waiting starts before the call is shown, so a decision can never arrive before it is heard.
		const waiting = awaitRuling(call.id, context.turnId);
		context.emit({ ...call });

		const ruling = await waiting;
		if (ruling.type === "canceled") {
			call.status = "canceled";

			return settle(call, context, "This call was canceled by the user.");
		}

		call.decidedAt = new Date().toISOString();

		if (ruling.type === "denied") {
			call.status = "denied";
			if (ruling.denyMessage !== undefined) call.denyMessage = ruling.denyMessage;

			return settle(call, context, denial(ruling.denyMessage));
		}

		call.status = "running";
	}

	// Shown as running so the user can cancel it, which is a race the call itself has to run.
	const stopping = awaitRuling(call.id, context.turnId);
	const attempt = attemptCall(builtin, input, context);
	context.emit({ ...call });

	const stopped = await Promise.race([attempt.then(() => false), stopping.then(() => true)]);
	forget(call.id);

	if (stopped) {
		call.status = "canceled";

		return settle(call, context, "This call was canceled by the user. Carry on without it.");
	}

	const { output, failure } = await attempt;
	if (failure === undefined) {
		call.output = output;
		call.status = "success";
	} else {
		call.error = failure;
		call.status = "error";
	}

	return settle(call, context, JSON.stringify(call.output ?? call.error));
}

/** The thread only ever holds settled facts, so this is where a call is written and shown as final. */
async function settle(
	call: ToolCall,
	context: CallContext,
	text: string,
): Promise<{ content: [{ type: "text"; text: string }]; isError: boolean }> {
	call.completedAt = new Date().toISOString();
	await appendEntry(context.file, call);
	context.emit({ ...call });

	return { content: [{ type: "text", text }], isError: call.status !== "success" };
}

function denial(denyMessage?: string): string {
	const notice = "The user denied this call. Do not try it again in this turn.";

	return denyMessage === undefined ? notice : `${notice} They said: ${denyMessage}`;
}
