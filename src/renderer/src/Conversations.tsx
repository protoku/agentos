import type { ConversationSummary } from "../../shared/api";

export function Conversations({
	conversations,
	onOpen,
}: {
	conversations: ConversationSummary[];
	onOpen: (id: string) => void;
}) {
	return (
		<main className="flex min-w-0 flex-1 flex-col">
			<header className="border-b border-border px-6 py-3 text-sm font-medium">Conversations</header>

			<div className="flex flex-1 flex-col overflow-y-auto">
				{conversations.length === 0 && (
					<p className="px-6 py-4 text-sm text-muted-foreground">Nothing here yet</p>
				)}

				{conversations.map((conversation) => (
					<button
						key={conversation.id}
						type="button"
						onClick={() => onOpen(conversation.id)}
						className="flex items-baseline gap-4 border-b border-border px-6 py-3 text-left hover:bg-muted"
					>
						<span className="flex-1 truncate text-sm">{conversation.title}</span>
						{conversation.archivedAt && (
							<span className="text-xs text-muted-foreground">Archived</span>
						)}
						<time className="text-xs text-muted-foreground" dateTime={conversation.lastActivityAt}>
							{moment(conversation.lastActivityAt)}
						</time>
					</button>
				))}
			</div>
		</main>
	);
}

export function moment(iso: string): string {
	return new Date(iso).toLocaleString([], {
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	});
}
