import { randomUUID } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { cancelRulings } from "./decisions";
import { claudeCodeMissing, claudeCodePath } from "../agents/claudeCode";
import { grantedTools } from "./tools";
import { carriedMemories, memoryBlock } from "../../shared/memory";
import { transcript } from "../../shared/transcript";
import { appendEntry, readEntries } from "../storage/conversationFile";
import { conversationFile, loadWorkspace } from "../storage/workspaceStore";
import { ensureSandbox } from "../tools/sandbox";
import type { AgentMessage, Entry, TurnEnd, TurnStart } from "../../shared/types";

export type EntrySink = (entry: Entry) => void;

interface Chain {
	canceled: boolean;
	settled?: Promise<void>;
	turn?: { id: string; stop: AbortController };
}

const chains = new Map<string, Chain>();

export function isTurnRunning(conversationId: string): boolean {
	return chains.has(conversationId);
}

/** Cancel stops the acting agent and skips every later mention, and is safe when nothing runs. */
export function cancelTurn(conversationId: string): void {
	const chain = chains.get(conversationId);
	if (chain === undefined) return;

	chain.canceled = true;
	if (chain.turn === undefined) return;

	// The pending call settles first, so its canceled entry is written before the turn unwinds.
	cancelRulings(chain.turn.id);
	chain.turn.stop.abort();
}

/** Canceling only asks: the turn still has its end entry to write, and this waits for that. */
export function whenTurnSettles(conversationId: string): Promise<void> | undefined {
	return chains.get(conversationId)?.settled;
}

/** Mentioned agents act one at a time; a turn that does not finish ends the chain. */
export function runMentionedTurns(
	root: string,
	workspaceId: string,
	conversationId: string,
	mentions: string[],
	emit: EntrySink,
): Promise<void> {
	const chain: Chain = { canceled: false };
	chains.set(conversationId, chain);
	chain.settled = runChain(root, workspaceId, conversationId, mentions, chain, emit).finally(() =>
		chains.delete(conversationId),
	);

	return chain.settled;
}

async function runChain(
	root: string,
	workspaceId: string,
	conversationId: string,
	mentions: string[],
	chain: Chain,
	emit: EntrySink,
): Promise<void> {
	for (const agentId of mentions) {
		if (chain.canceled) return;

		const end = await runTurn(root, workspaceId, conversationId, agentId, chain, emit);
		if (end.status !== "finished") return;
	}
}

async function runTurn(
	root: string,
	workspaceId: string,
	conversationId: string,
	agentId: string,
	chain: Chain,
	emit: EntrySink,
): Promise<TurnEnd> {
	const file = conversationFile(root, workspaceId, conversationId);
	const workspace = await loadWorkspace(root, workspaceId);
	const agent = workspace.agents.find((candidate) => candidate.id === agentId);

	const start: TurnStart = { type: "turnStart", id: randomUUID(), agentId, createdAt: now() };
	const stop = new AbortController();
	await appendEntry(file, start);
	emit(start);
	chain.turn = { id: start.id, stop };

	let error: string | undefined;

	try {
		if (agent === undefined) throw new Error(`No agent ${agentId}`);

		const claudeCode = await claudeCodePath();
		if (claudeCode === undefined) throw new Error(claudeCodeMissing);

		const sandbox = await ensureSandbox(root, workspaceId, conversationId);
		const prompt = transcript(await readEntries(file), workspace.agents, agent);
		// Read as the turn starts, so an agent is handed what the workspace knows right now.
		const carried = memoryBlock(carriedMemories(workspace.memories, agent.carries));
		const granted = await grantedTools(agent, {
			root,
			workspaceId,
			conversationId,
			sandbox,
			file,
			agentId,
			turnId: start.id,
			emit,
			stopped: () => chain.canceled,
		});

		for await (const message of query({
			prompt,
			options: {
				model: agent.model,
				systemPrompt: carried.length === 0 ? agent.systemPrompt : `${agent.systemPrompt}\n\n${carried}`,
				cwd: sandbox,
				// The machine's own Claude Code drives the turn, rather than a copy shipped with the app.
				pathToClaudeCodeExecutable: claudeCode,
				settingSources: [],
				abortController: stop,
				// Nothing but what the workspace grants: no editor tools of its own, no command runner.
				tools: [],
				mcpServers: { agentos: granted.server },
				allowedTools: granted.allowedTools,
			},
		})) {
			// The abort is not instant, so nothing the agent says after the cancel joins the thread.
			if (chain.canceled) break;
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

	// A canceled turn stopped on request: whatever the abort threw is not a failure to report.
	const status = chain.canceled ? "canceled" : error === undefined ? "finished" : "failed";
	const end: TurnEnd = {
		type: "turnEnd",
		id: randomUUID(),
		turnId: start.id,
		status,
		...(status === "failed" && error !== undefined && { error }),
		createdAt: now(),
	};
	await appendEntry(file, end);
	emit(end);

	return end;
}

function now(): string {
	return new Date().toISOString();
}
