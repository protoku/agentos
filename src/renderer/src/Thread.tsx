import { useEffect, useRef, useState } from "react";
import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { moment } from "./Conversations";
import { findMentions } from "../../shared/mentions";
import type { Agent, Entry, ToolCall } from "../../shared/types";

export function Thread({
	title,
	entries,
	agents,
	toolsEnabled,
	archivedAt,
	onSend,
	onCancel,
	onArchive,
}: {
	title: string;
	entries: Entry[];
	agents: Agent[];
	toolsEnabled: boolean;
	archivedAt?: string;
	onSend: (content: string) => Promise<void>;
	onCancel: () => Promise<void>;
	onArchive?: () => Promise<void>;
}) {
	const [draft, setDraft] = useState("");
	const [refused, setRefused] = useState<string>();
	const newest = useRef<HTMLDivElement>(null);

	// A start with no end is a turn running right now, and the thread belongs to that agent.
	const endedTurns = new Set(entries.filter((entry) => entry.type === "turnEnd").map((entry) => entry.turnId));
	const acting = entries.some((entry) => entry.type === "turnStart" && !endedTurns.has(entry.id));

	// The thread follows the newest entry, so a sent message or a tool call is never below the fold.
	useEffect(() => {
		newest.current?.scrollIntoView({ block: "end" });
	}, [entries]);

	async function send() {
		const content = draft.trim();
		if (content.length === 0) return;

		if (acting) return;

		if (content.startsWith("/") && !toolsEnabled) {
			return setRefused("A tool call needs a conversation. Send a message first.");
		}

		setRefused(undefined);
		setDraft("");
		await onSend(content);
	}

	return (
		<main className="flex min-w-0 flex-1 flex-col">
			<header className="flex items-center justify-between gap-4 border-b border-border py-2 pr-2 pl-6">
				<span className="truncate text-sm font-medium">{title}</span>
				{onArchive && archivedAt === undefined && (
					<Button variant="ghost" size="sm" onClick={() => void onArchive()}>
						Archive
					</Button>
				)}
			</header>

			<div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
				{entries.map((entry) => (
					<EntryView key={entry.id} entry={entry} agents={agents} endedTurns={endedTurns} />
				))}
				<div ref={newest} />
			</div>

			{archivedAt ? (
				<p className="border-t border-border px-6 py-4 text-sm text-muted-foreground">
					Archived on {moment(archivedAt)}. This conversation is closed.
				</p>
			) : (
				<div className="flex items-end gap-2 border-t border-border p-4">
					<Textarea
						autoFocus
						value={draft}
						disabled={acting}
						placeholder={acting ? "An agent is acting in this conversation" : "Message"}
						className="max-h-48 min-h-16 flex-1 resize-none"
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								void send();
							}
						}}
					/>
					{acting ? (
						<Button size="icon" variant="outline" aria-label="Stop" onClick={() => void onCancel()}>
							<Square className="fill-current" />
						</Button>
					) : (
						<Button onClick={() => void send()}>Send</Button>
					)}
				</div>
			)}

			{refused && <p className="px-4 pb-3 text-sm text-destructive">{refused}</p>}
		</main>
	);
}

function EntryView({
	entry,
	agents,
	endedTurns,
}: {
	entry: Entry;
	agents: Agent[];
	endedTurns: Set<string>;
}) {
	switch (entry.type) {
		case "toolCall":
			return <ToolCallView call={entry} agents={agents} />;
		case "turnStart":
			return endedTurns.has(entry.id) ? null : (
				<p className="text-sm text-muted-foreground">@{agentName(agents, entry.agentId)} is working…</p>
			);
		case "turnEnd":
			return entry.status === "finished" ? null : (
				<p className="text-sm text-destructive">
					Turn {entry.status}. {entry.error}
				</p>
			);
		case "userMessage":
		case "agentMessage":
			return (
				<article className="flex flex-col gap-1">
					<div className="flex items-baseline gap-2 text-xs text-muted-foreground">
						<span className="font-medium text-foreground">
							{entry.type === "userMessage" ? "You" : `@${agentName(agents, entry.agentId)}`}
						</span>
						<time dateTime={entry.createdAt}>{time(entry.createdAt)}</time>
					</div>
					<p className="text-sm whitespace-pre-wrap">{withMentions(entry.content, agents)}</p>
				</article>
			);
	}
}

function agentName(agents: Agent[], agentId: string): string {
	return agents.find((agent) => agent.id === agentId)?.name ?? "unknown";
}

const statusColors: Record<ToolCall["status"], string> = {
	pending: "text-pending",
	running: "text-muted-foreground",
	success: "text-success",
	error: "text-destructive",
	denied: "text-destructive",
	canceled: "text-muted-foreground",
};

function ToolCallView({ call, agents }: { call: ToolCall; agents: Agent[] }) {
	const [denyMessage, setDenyMessage] = useState("");

	function decide(allowed: boolean) {
		const message = denyMessage.trim();

		void window.agentOS.decideToolCall(call.id, {
			allowed,
			...(!allowed && message.length > 0 && { denyMessage: message }),
		});
	}

	return (
		<article className="flex flex-col gap-2 rounded-lg border border-border p-3">
			<div className="flex items-baseline gap-2 text-xs">
				<span className="font-medium">
					{call.agentId === undefined ? "You" : `@${agentName(agents, call.agentId)}`}
				</span>
				<span className="font-medium">{call.toolId}</span>
				<span className={statusColors[call.status]}>{call.status}</span>
				<time className="text-muted-foreground" dateTime={call.createdAt}>
					{time(call.createdAt)}
				</time>
			</div>

			{call.reason && <p className="text-xs text-muted-foreground">{call.reason}</p>}

			<Payload label="Input" value={call.input} />
			{call.output && <Payload label="Output" value={call.output} />}
			{call.error && <p className="text-sm text-destructive">{call.error}</p>}
			{call.denyMessage && <p className="text-sm text-destructive">{call.denyMessage}</p>}

			{call.status === "pending" && (
				<div className="flex items-center gap-2">
					<Input
						value={denyMessage}
						placeholder="Why not, if you deny"
						className="h-8 flex-1 text-xs"
						onChange={(event) => setDenyMessage(event.target.value)}
					/>
					<Button
						size="sm"
						variant="outline"
						className="border-success text-success"
						onClick={() => decide(true)}
					>
						Approve
					</Button>
					<Button
						size="sm"
						variant="outline"
						className="border-destructive text-destructive"
						onClick={() => decide(false)}
					>
						Deny
					</Button>
				</div>
			)}
		</article>
	);
}

function Payload({ label, value }: { label: string; value: Record<string, unknown> }) {
	return (
		<div className="flex flex-col gap-1">
			<span className="text-xs tracking-wide text-muted-foreground uppercase">{label}</span>
			<pre className="overflow-x-auto rounded-md bg-elevated p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>
		</div>
	);
}

/** The @names are presentation: they are highlighted only where they resolved to an agent. */
function withMentions(content: string, agents: Agent[]) {
	const parts = [];
	let cursor = 0;

	for (const [index, mention] of findMentions(content, agents).entries()) {
		parts.push(content.slice(cursor, mention.start));
		parts.push(
			<span key={index} className="font-medium text-foreground">
				{content.slice(mention.start, mention.end)}
			</span>,
		);
		cursor = mention.end;
	}

	parts.push(content.slice(cursor));

	return parts;
}

function time(iso: string): string {
	return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
