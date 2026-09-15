import { carriedMemories, memoryBlock } from "./memory";
import { estimateTokens, tokens } from "./transcript";
import type { Agent, Entry, Memory, Tool, TurnEnd, TurnStart } from "./types";

/** What a turn carries, one part at a time, each priced the way the conversation's size is. */
export interface Part {
	name: string;
	kind: "prompt" | "memories" | "tool" | "thread";
	tokens: number;
}

export interface Sending {
	parts: Part[];
	/** What the parts come to, estimated at four characters a token like every other figure here. */
	estimated: number;
	/** What this agent's last turn was sent in all, over however many requests it made. */
	measured?: number;
	/** How many times that turn asked the model, since a turn that calls tools asks again each time. */
	requests?: number;
	/**
	 * What the measurement holds that the parts do not: the framing Claude Code adds, and our error.
	 * Only a turn of one request can say this, since a longer one carries more on every request it
	 * makes and the difference would be that growth rather than the framing.
	 */
	unaccounted?: number;
}

/** The name a tool is called by once it is handed over, which is the name the model is sent. */
const namespaced = "mcp__agentos__";

/** Every granted tool carries this argument too, added when the turn hands the tool over. */
const reason = JSON.stringify({
	reason: { type: "string", description: "Why you are making this call, in one short sentence." },
});

/**
 * What the next turn by this agent would carry. The parts are estimates and the measurement is
 * not, so what separates them is worth showing rather than hiding: most of it is what Claude Code
 * wraps around every turn, which no workspace setting reaches.
 */
export function sending(entries: Entry[], agents: Agent[], tools: Tool[], memories: Memory[], acting: Agent): Sending {
	const parts: Part[] = [{ name: "System prompt", kind: "prompt", tokens: estimateTokens(acting.systemPrompt) }];

	const carried = carriedMemories(memories, acting.carries);
	if (carried.length > 0) {
		const what = carried.length === 1 ? "memory" : "memories";
		parts.push({ name: `Carried ${what}`, kind: "memories", tokens: estimateTokens(memoryBlock(carried)) });
	}

	// Heaviest first, since trimming a permission list starts at the top of it.
	const held = granted(tools, acting)
		.map((tool) => ({
			name: tool.name,
			kind: "tool" as const,
			tokens: estimateTokens(
				`${namespaced}${tool.name}${tool.description}${JSON.stringify(tool.inputSchema)}${reason}`,
			),
		}))
		.sort((first, second) => second.tokens - first.tokens);

	parts.push(...held);

	parts.push({ name: "This conversation", kind: "thread", tokens: tokens(entries, agents) });

	const estimated = parts.reduce((total, part) => total + part.tokens, 0);
	const last = lastTurnOf(entries, acting.id)?.spent;
	// A turn that never recorded its count cannot claim to be one, so it says nothing rather than guess.
	const single = last?.requests === 1;

	return {
		parts,
		estimated,
		...(last !== undefined && {
			measured: last.sent,
			...(last.requests !== undefined && { requests: last.requests }),
			...(single && { unaccounted: Math.max(last.sent - estimated, 0) }),
		}),
	};
}

/** What the agent may use, which is what the turn hands over: denied is the same as unlisted. */
export function granted(tools: Tool[], agent: Agent): Tool[] {
	return tools.filter((tool) => agent.tools[tool.id] !== undefined && agent.tools[tool.id] !== "deny");
}

/** Who has acted in this conversation, whoever acted last first, which is the turn just paid for. */
export function actedHere(entries: Entry[], agents: Agent[]): Agent[] {
	const acted: Agent[] = [];

	for (const entry of [...entries].reverse()) {
		if (entry.type !== "turnStart") continue;

		const agent = agents.find((candidate) => candidate.id === entry.agentId);
		if (agent !== undefined && !acted.includes(agent)) acted.push(agent);
	}

	return acted;
}

/** The last turn this agent finished, which is the only measurement of what it is really sent. */
function lastTurnOf(entries: Entry[], agentId: string): TurnEnd | undefined {
	const mine = entries
		.filter((entry): entry is TurnStart => entry.type === "turnStart" && entry.agentId === agentId)
		.map((start) => start.id);

	return [...entries]
		.reverse()
		.find((entry): entry is TurnEnd => entry.type === "turnEnd" && mine.includes(entry.turnId));
}
