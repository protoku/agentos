import { randomUUID } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { transcript } from "./transcript";
import { appendEntry, readEntries } from "../storage/conversationFile";
import { conversationFile, loadWorkspace } from "../storage/workspaceStore";
import { ensureSandbox } from "../tools/sandbox";
import type { AgentMessage, Entry, TurnEnd, TurnStart } from "../../shared/types";

export type EntrySink = (entry: Entry) => void;

const runningConversations = new Set<string>();

export function isTurnRunning(conversationId: string): boolean {
	return runningConversations.has(conversationId);
}

/** Mentioned agents act one at a time; a failed turn ends the chain, so later agents never start. */
export async function runMentionedTurns(
	root: string,
	workspaceId: string,
	conversationId: string,
	mentions: string[],
	emit: EntrySink,
): Promise<void> {
	runningConversations.add(conversationId);

	try {
		for (const agentId of mentions) {
			const end = await runTurn(root, workspaceId, conversationId, agentId, emit);
			if (end.status !== "finished") return;
		}
	} finally {
		runningConversations.delete(conversationId);
	}
}

async function runTurn(
	root: string,
	workspaceId: string,
	conversationId: string,
	agentId: string,
	emit: EntrySink,
): Promise<TurnEnd> {
	const file = conversationFile(root, workspaceId, conversationId);
	const workspace = await loadWorkspace(root, workspaceId);
	const agent = workspace.agents.find((candidate) => candidate.id === agentId);

	const start: TurnStart = { type: "turnStart", id: randomUUID(), agentId, createdAt: now() };
	await appendEntry(file, start);
	emit(start);

	let error: string | undefined;

	try {
		if (agent === undefined) throw new Error(`No agent ${agentId}`);

		const sandbox = await ensureSandbox(root, workspaceId, conversationId);
		const prompt = transcript(await readEntries(file), workspace.agents, agent);

		for await (const message of query({
			prompt,
			options: {
				model: agent.model,
				systemPrompt: agent.systemPrompt,
				cwd: sandbox,
				settingSources: [],
				allowedTools: [],
			},
		})) {
			if (message.type !== "assistant") continue;

			const content = message.message.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("")
				.trim();
			if (content.length === 0) continue;

			const said: AgentMessage = {
				type: "agentMessage",
				id: randomUUID(),
				agentId,
				turnId: start.id,
				content,
				createdAt: now(),
			};
			await appendEntry(file, said);
			emit(said);
		}
	} catch (failure) {
		error = failure instanceof Error ? failure.message : String(failure);
	}

	const end: TurnEnd = {
		type: "turnEnd",
		id: randomUUID(),
		turnId: start.id,
		status: error === undefined ? "finished" : "failed",
		...(error !== undefined && { error }),
		createdAt: now(),
	};
	await appendEntry(file, end);
	emit(end);

	return end;
}

function now(): string {
	return new Date().toISOString();
}
