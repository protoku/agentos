import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { moment } from "./Conversations";
import type { Entry } from "../../shared/types";

export function Thread({
	title,
	entries,
	archivedAt,
	onSend,
	onArchive,
}: {
	title: string;
	entries: Entry[];
	archivedAt?: string;
	onSend: (content: string) => Promise<void>;
	onArchive?: () => Promise<void>;
}) {
	const [draft, setDraft] = useState("");

	async function send() {
		const content = draft.trim();
		if (content.length === 0) return;

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
					<EntryView key={entry.id} entry={entry} />
				))}
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
						placeholder="Message"
						className="max-h-48 min-h-16 flex-1 resize-none"
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								void send();
							}
						}}
					/>
					<Button onClick={() => void send()}>Send</Button>
				</div>
			)}
		</main>
	);
}

function EntryView({ entry }: { entry: Entry }) {
	// Threads hold nothing but user messages until agents and tools arrive.
	if (entry.type !== "userMessage") return null;

	return (
		<article className="flex flex-col gap-1">
			<div className="flex items-baseline gap-2 text-xs text-muted-foreground">
				<span className="font-medium text-foreground">You</span>
				<time dateTime={entry.createdAt}>{time(entry.createdAt)}</time>
			</div>
			<p className="text-sm whitespace-pre-wrap">{entry.content}</p>
		</article>
	);
}

function time(iso: string): string {
	return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
