import { useEffect, useRef, useState } from "react";
import { ArrowUp, Boxes, Check, Copy, FolderOpen, Square, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { moment } from "./Conversations";
import { Markdown } from "./Markdown";
import { completionAt, type Candidate } from "../../shared/completions";
import { findMentions } from "../../shared/mentions";
import type { Agent, Entry, Mount, Tool, ToolCall } from "../../shared/types";

export function Thread({
	title,
	entries,
	agents,
	tools,
	mounts,
	sandbox,
	archivedAt,
	onSend,
	onCancel,
	onOpenSandbox,
	onOpenPath,
	onArchive,
}: {
	title: string;
	entries: Entry[];
	agents: Agent[];
	tools: Tool[];
	mounts: Mount[];
	sandbox?: string;
	archivedAt?: string;
	onSend: (content: string) => Promise<void>;
	onCancel: () => Promise<void>;
	onOpenSandbox: () => Promise<void>;
	onOpenPath: (path: string) => void;
	onArchive?: () => Promise<void>;
}) {
	const [draft, setDraft] = useState("");
	const [caret, setCaret] = useState(0);
	const [highlight, setHighlight] = useState(0);
	const [dismissed, setDismissed] = useState(false);
	const composer = useRef<HTMLTextAreaElement>(null);

	// A start with no end is a turn running right now, and the thread belongs to that agent.
	const endedTurns = new Set(entries.filter((entry) => entry.type === "turnEnd").map((entry) => entry.turnId));
	const acting = entries.some((entry) => entry.type === "turnStart" && !endedTurns.has(entry.id));
	// A call of the user's own occupies the thread the same way, and is canceled on its entry.
	const calling = entries.some(
		(entry) => entry.type === "toolCall" && (entry.status === "running" || entry.status === "pending"),
	);
	const busy = acting || calling;

	const completion = dismissed ? undefined : completionAt(draft, caret, tools, agents);
	// Who has taken part, which is not the same as who the workspace has.
	const present = agents.filter((agent) =>
		entries.some(
			(entry) => (entry.type === "turnStart" || entry.type === "agentMessage") && entry.agentId === agent.id,
		),
	);

	// A different list starts at its first name, never at wherever the last one was left.
	useEffect(() => {
		setHighlight(0);
	}, [draft, caret]);

	function accept(candidate: Candidate) {
		if (completion === undefined) return;

		const caretAfter = completion.start + candidate.name.length + completion.suffix.length;
		setDraft(
			`${draft.slice(0, completion.start)}${candidate.name}${completion.suffix}${draft.slice(completion.end)}`,
		);
		setCaret(caretAfter);
		composer.current?.focus();
		// The value lands on the element after this render, so the caret is placed once it has.
		requestAnimationFrame(() => composer.current?.setSelectionRange(caretAfter, caretAfter));
	}

	function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
		const count = completion?.candidates.length ?? 0;

		if (completion !== undefined) {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				return setHighlight((current) => (current + 1) % count);
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				return setHighlight((current) => (current - 1 + count) % count);
			}
			if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();
				return accept(completion.candidates[highlight]);
			}
			if (event.key === "Escape") {
				event.preventDefault();
				return setDismissed(true);
			}
		}

		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			void send();
		}
	}

	async function send() {
		const content = draft.trim();
		if (content.length === 0) return;

		if (busy) return;

		setDraft("");
		await onSend(content);
	}

	return (
		<main className="flex min-w-0 flex-1 flex-col">
			<header className="flex items-center gap-4 border-b border-border py-2 pr-2 pl-6">
				<span className="shrink-0 truncate text-sm font-medium">{title}</span>

				<div className="flex min-w-0 flex-1 items-center gap-4 text-xs text-muted-foreground">
					{mounts.length > 0 && (
						<Bound label="Mounted" icon={<Boxes className="size-3.5" />}>
							{mounts.map((mount) => `${mount.path}${mount.readOnly ? " (read-only)" : ""}`).join(", ")}
						</Bound>
					)}
					{present.length > 0 && (
						<Bound label="In this conversation" icon={<Users className="size-3.5" />}>
							{present.map((agent) => `@${agent.name}`).join(", ")}
						</Bound>
					)}
				</div>

				{sandbox && (
					<Button variant="ghost" size="sm" title={sandbox} onClick={() => void onOpenSandbox()}>
						<FolderOpen />
						Sandbox
					</Button>
				)}
				{onArchive && archivedAt === undefined && (
					<Button variant="ghost" size="sm" onClick={() => void onArchive()}>
						Archive
					</Button>
				)}
			</header>

			{/* No scroll anchors: anchoring a turn to the top reserves a viewport of empty space
			    below it, which reads as a hole in a thread of short entries. */}
			<MessageScrollerProvider autoScroll defaultScrollPosition="end">
				<MessageScroller className="flex-1">
					<MessageScrollerViewport>
						<MessageScrollerContent className="flex flex-col gap-5 px-6 py-5">
							{entries.filter((entry) => shows(entry, endedTurns)).map((entry) => (
								<MessageScrollerItem key={entry.id} messageId={entry.id}>
									<EntryView
										entry={entry}
										agents={agents}
										endedTurns={endedTurns}
										onOpenPath={onOpenPath}
									/>
								</MessageScrollerItem>
							))}
						</MessageScrollerContent>
					</MessageScrollerViewport>
					<MessageScrollerButton />
				</MessageScroller>
			</MessageScrollerProvider>

			{archivedAt ? (
				<p className="border-t border-border px-6 py-4 text-sm text-muted-foreground">
					Archived on {moment(archivedAt)}. This conversation is closed.
				</p>
			) : (
				<div className="relative border-t border-border p-4">
					{completion && (
						<ul className="absolute bottom-full left-4 mb-2 max-h-64 w-96 overflow-y-auto rounded-lg border border-border bg-popover p-1">
							{completion.candidates.map((candidate, index) => (
								<li key={candidate.id}>
									<button
										type="button"
										// The composer keeps the focus, so the caret is still there when this accepts.
										onMouseDown={(event) => event.preventDefault()}
										onClick={() => accept(candidate)}
										className={cn(
											"w-full rounded-md px-2 py-1.5 text-left",
											index === highlight ? "bg-muted" : "hover:bg-muted/50",
										)}
									>
										<span className="text-sm">{candidate.name}</span>
										{candidate.description && (
											<span className="block truncate text-xs text-muted-foreground">
												{candidate.description}
											</span>
										)}
									</button>
								</li>
							))}
						</ul>
					)}

					<div className="flex flex-col gap-1 rounded-xl border border-border p-2 focus-within:border-ring">
						<Textarea
							autoFocus
							ref={composer}
							value={draft}
							disabled={busy}
							placeholder={
								acting
									? "An agent is acting in this conversation"
									: calling
										? "A tool call is running in this conversation"
										: "Message"
							}
							className="max-h-48 min-h-10 resize-none border-0 px-2 py-1.5 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
							onChange={(event) => {
								setDraft(event.target.value);
								setCaret(event.target.selectionStart);
								setDismissed(false);
							}}
							onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
							onKeyDown={onKeyDown}
						/>

						<div className="flex justify-end">
							{acting ? (
								<Button
									size="icon-sm"
									variant="outline"
									aria-label="Stop"
									className="rounded-full"
									onClick={() => void onCancel()}
								>
									<Square className="fill-current" />
								</Button>
							) : (
								<Button
									size="icon-sm"
									aria-label="Send"
									className="rounded-full"
									disabled={busy}
									onClick={() => void send()}
								>
									<ArrowUp />
								</Button>
							)}
						</div>
					</div>
				</div>
			)}

		</main>
	);
}

function Bound({ label, icon, children }: { label: string; icon: React.ReactNode; children: string }) {
	return (
		<span className="flex min-w-0 items-center gap-1.5" title={`${label}: ${children}`}>
			{icon}
			<span className="truncate">{children}</span>
		</span>
	);
}

/** What a call acted on, if it named a file at all: a move ends at its destination. */
export function pathOf(call: ToolCall): string | undefined {
	const named = call.input.to ?? call.input.path;

	return typeof named === "string" ? named : undefined;
}

/** A finished turn's markers say nothing, and a row wrapped around nothing would still take space. */
function shows(entry: Entry, endedTurns: Set<string>): boolean {
	if (entry.type === "turnStart") return !endedTurns.has(entry.id);
	if (entry.type === "turnEnd") return entry.status !== "finished";

	return true;
}

function EntryView({
	entry,
	agents,
	endedTurns,
	onOpenPath,
}: {
	entry: Entry;
	agents: Agent[];
	endedTurns: Set<string>;
	onOpenPath: (path: string) => void;
}) {
	switch (entry.type) {
		case "toolCall":
			return <ToolCallView call={entry} agents={agents} onOpenPath={onOpenPath} />;
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
				<article className="group flex flex-col gap-1">
					<div className="flex items-baseline gap-2 text-xs text-muted-foreground">
						<span className="font-medium text-foreground">
							{entry.type === "userMessage" ? "You" : `@${agentName(agents, entry.agentId)}`}
						</span>
						<time dateTime={entry.createdAt}>{time(entry.createdAt)}</time>
						<CopyButton label="Copy message" text={entry.content} />
					</div>
					{entry.type === "userMessage" ? (
						<p className="text-sm whitespace-pre-wrap">{withMentions(entry.content, agents)}</p>
					) : (
						<Markdown content={entry.content} />
					)}
				</article>
			);
	}
}

/** A message copies its text, a tool call its input and output; turn entries have nothing to copy. */
function CopyButton({ label, text }: { label: string; text: string }) {
	const [copied, setCopied] = useState(false);

	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			className={cn(
				"rounded-md p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground",
				copied && "text-success opacity-100",
			)}
			onClick={() => {
				void navigator.clipboard.writeText(text);
				setCopied(true);
				setTimeout(() => setCopied(false), 1200);
			}}
		>
			{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
		</button>
	);
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

function ToolCallView({
	call,
	agents,
	onOpenPath,
}: {
	call: ToolCall;
	agents: Agent[];
	onOpenPath: (path: string) => void;
}) {
	const [denyMessage, setDenyMessage] = useState("");
	const path = pathOf(call);

	function decide(allowed: boolean) {
		const message = denyMessage.trim();

		void window.agentOS.decideToolCall(call.id, {
			allowed,
			...(!allowed && message.length > 0 && { denyMessage: message }),
		});
	}

	return (
		<article className="group flex flex-col gap-2 rounded-lg border border-border p-3">
			<div className="flex items-baseline gap-2 text-xs">
				<span className="font-medium">
					{call.agentId === undefined ? "You" : `@${agentName(agents, call.agentId)}`}
				</span>
				{path === undefined ? (
					<span className="font-medium">{call.toolId}</span>
				) : (
					<button
						type="button"
						title={`Open ${path}`}
						className="font-medium underline-offset-4 hover:underline"
						onClick={() => onOpenPath(path)}
					>
						{call.toolId}
					</button>
				)}
				<span className={statusColors[call.status]}>{call.status}</span>
				<time className="text-muted-foreground" dateTime={call.createdAt}>
					{time(call.createdAt)}
				</time>
				<CopyButton
					label="Copy input and output"
					text={JSON.stringify({ input: call.input, ...(call.output && { output: call.output }) }, null, 2)}
				/>
			</div>

			{call.reason && <p className="text-xs text-muted-foreground">{call.reason}</p>}

			<Payload label="Input" value={call.input} />
			{call.output && <Payload label="Output" value={call.output} />}
			{call.error && <p className="text-sm text-destructive">{call.error}</p>}
			{call.denyMessage && <p className="text-sm text-destructive">{call.denyMessage}</p>}

			{call.status === "running" && (
				<div>
					<Button size="sm" variant="outline" onClick={() => void window.agentOS.cancelToolCall(call.id)}>
						Cancel
					</Button>
				</div>
			)}

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
			<pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>
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
