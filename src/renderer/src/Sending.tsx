import { useEffect, useState } from "react";
import { Coins, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { thousands } from "./format";
import { actedHere, sending, type Part, type Sending as Payloads } from "../../shared/sending";
import type { Agent, Entry, Memory, Tool } from "../../shared/types";

/** What the next turn would carry, beside the thread that would carry it. */
export function Sending({
	workspaceId,
	entries,
	agents,
	tools,
	onClose,
}: {
	workspaceId: string;
	entries: Entry[];
	agents: Agent[];
	tools: Tool[];
	onClose: () => void;
}) {
	const acted = actedHere(entries, agents);
	const [picked, setPicked] = useState<string>();
	const acting = acted.find((agent) => agent.id === picked) ?? acted[0];
	// An agent pays for what it carries on every turn, so the pane prices it from the same list.
	const [memories, setMemories] = useState<Memory[]>([]);

	useEffect(() => {
		void window.agentOS.listMemories(workspaceId).then(setMemories);
	}, [workspaceId]);

	return (
		<>
			<header className="flex items-center gap-2 border-b border-border py-2 pr-2 pl-4">
				<Coins className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate text-sm font-medium">What a turn sends</span>
				<Button variant="ghost" size="icon-sm" aria-label="Close what a turn sends" onClick={onClose}>
					<X />
				</Button>
			</header>

			<div className="min-h-0 flex-1 overflow-auto p-4">
				{acting === undefined ? (
					<p className="text-sm text-muted-foreground">
						Nobody has acted here yet. Mention an agent, and what its turn carries is listed here.
					</p>
				) : (
					<Payload entries={entries} agents={agents} tools={tools} memories={memories} acting={acting}>
						{acted.length > 1 && (
							<div className="flex flex-wrap gap-1 pb-3">
								{acted.map((agent) => (
									<button
										key={agent.id}
										type="button"
										onClick={() => setPicked(agent.id)}
										className={cn(
											"rounded-md px-2 py-1 text-xs",
											agent.id === acting.id
												? "bg-accent text-accent-foreground"
												: "text-muted-foreground hover:bg-muted hover:text-foreground",
										)}
									>
										@{agent.name}
									</button>
								))}
							</div>
						)}
					</Payload>
				)}
			</div>
		</>
	);
}

function Payload({
	entries,
	agents,
	tools,
	memories,
	acting,
	children,
}: {
	entries: Entry[];
	agents: Agent[];
	tools: Tool[];
	memories: Memory[];
	acting: Agent;
	children: React.ReactNode;
}) {
	const what = sending(entries, agents, tools, memories, acting);
	const held = what.parts.filter((part) => part.kind === "tool");
	const widest = Math.max(...what.parts.map((part) => part.tokens), 1);

	return (
		<div className="flex flex-col gap-3 text-sm">
			{children}

			<div className="flex flex-col">
				{what.parts
					.filter((part) => part.kind !== "tool")
					.map((part) => (
						<Row key={part.name} part={part} widest={widest} />
					))}
			</div>

			{held.length > 0 && (
				<div className="flex flex-col">
					<p className="pb-1 text-xs text-muted-foreground">
						{held.length} {held.length === 1 ? "tool" : "tools"}, heaviest first
					</p>
					{held.map((part) => (
						<Row key={part.name} part={part} widest={widest} />
					))}
				</div>
			)}

			<dl className="flex flex-col gap-1 border-t border-border pt-3">
				<Total label="Reckoned, for one request" value={`~${thousands(what.estimated)}`} />
				{what.measured !== undefined && (
					<Total
						label={
							what.requests === undefined
								? "Last turn, measured"
								: `Last turn, over ${what.requests} ${what.requests === 1 ? "request" : "requests"}`
						}
						value={thousands(what.measured)}
					/>
				)}
				{what.unaccounted !== undefined && (
					<Total label="Not ours" value={thousands(what.unaccounted)} strong />
				)}
			</dl>

			<p className="text-xs leading-relaxed text-muted-foreground">{explained(what)}</p>
		</div>
	);
}

function Row({ part, widest }: { part: Part; widest: number }) {
	return (
		<div className="flex items-center gap-3 py-1" title={`${part.name}: about ${part.tokens} tokens`}>
			<span className="min-w-0 flex-1 truncate">{part.name}</span>
			<span className="h-1 w-16 shrink-0 rounded-full bg-muted">
				<span
					className="block h-1 rounded-full bg-muted-foreground"
					style={{ width: `${Math.max((part.tokens / widest) * 100, 2)}%` }}
				/>
			</span>
			<span className="w-12 shrink-0 text-right text-muted-foreground tabular-nums">
				{thousands(part.tokens)}
			</span>
		</div>
	);
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
	return (
		<div className={cn("flex items-baseline justify-between gap-3", strong && "font-medium")}>
			<dt className={cn(!strong && "text-muted-foreground")}>{label}</dt>
			<dd className="tabular-nums">{value}</dd>
		</div>
	);
}

/** What the figures do and do not say, which matters more here than anywhere else in the app. */
function explained(what: Payloads): string {
	if (what.measured === undefined) {
		return "Every figure here is reckoned at four characters a token. What a turn really costs is measured only once it has taken one.";
	}

	if (what.unaccounted !== undefined) {
		return "That turn was a single request, so what is not ours is the framing Claude Code puts around it, plus whatever the reckoning above got wrong at four characters a token.";
	}

	if (what.requests === undefined) {
		return "That turn was recorded before AgentOS kept how many requests a turn makes, so its total cannot be set against the reckoning above. The next turn can.";
	}

	return "A turn asks the model again after every tool call, carrying more each time, so its total is not one request and cannot be set against the reckoning above. A turn that answers without calling a tool can.";
}
