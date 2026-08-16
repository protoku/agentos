import { randomUUID } from "node:crypto";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { awaitRuling, forget } from "./decisions";
import { appendEntry } from "../storage/conversationFile";
import { attemptCall } from "../tools/attempt";
import { builtinTools } from "../tools/builtin";
import { implementationOf } from "../tools/script";
import { listScriptTools } from "../storage/scriptTools";
import type { ToolImplementation, ToolTarget } from "../tools/define";
import type { Agent, ToolCall } from "../../shared/types";
import type { EntrySink } from "./run";

const serverName = "agentos";
const reason = z.string().describe("Why you are making this call, in one short sentence.");

export interface CallContext extends ToolTarget {
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
export async function grantedTools(agent: Agent, context: CallContext) {
	const scripts = await listScriptTools(context.root, context.workspaceId);
	const granted = [...builtinTools, ...scripts.map(implementationOf)].filter(
		(tool) => agent.tools[tool.id] !== undefined,
	);

	return {
		server: createSdkMcpServer({
			name: serverName,
			tools: granted.map((granted) =>
				tool(granted.name, granted.description, { ...granted.input.shape, reason }, (args) =>
					record(granted, agent.tools[granted.id] === "ask", args, context),
				),
			),
		}),
		allowedTools: granted.map((granted) => `mcp__${serverName}__${granted.name}`),
	};
}

async function record(
	builtin: ToolImplementation,
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
	const stop = new AbortController();
	const attempt = attemptCall(builtin, input, { ...context, signal: stop.signal });
	context.emit({ ...call });

	const stopped = await Promise.race([attempt.then(() => false), stopping.then(() => true)]);
	forget(call.id);

	if (stopped) {
		// Canceling is not just letting go of the result: the work itself stops here.
		stop.abort();
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
