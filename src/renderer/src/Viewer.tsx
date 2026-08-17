import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Markdown } from "./Markdown";
import type { SandboxView } from "../../shared/api";

/**
 * A file as it is now, beside the thread that changed it. It never edits: work on a file happens
 * through the conversation, so that every change is a tool call somebody can read.
 */
export function Viewer({
	workspaceId,
	conversationId,
	path,
	version,
	onClose,
}: {
	workspaceId: string;
	conversationId: string;
	path: string;
	/** Bumped by the thread when a call touches this path, which is what makes the viewer follow. */
	version: number;
	onClose: () => void;
}) {
	const [view, setView] = useState<SandboxView>();
	const [width, setWidth] = useState(rememberedWidth);

	useEffect(() => {
		let current = true;
		setView(undefined);

		void window.agentOS.viewSandboxPath(workspaceId, conversationId, path).then((found) => {
			if (current) setView(found);
		});

		return () => void (current = false);
	}, [workspaceId, conversationId, path, version]);

	function resizeTo(next: number) {
		const within = withinReason(next);

		setWidth(within);
		localStorage.setItem(remembered, String(within));
	}

	/** The pane grows as the handle moves left, and the width it lands on is the one kept. */
	function drag(event: React.PointerEvent) {
		event.preventDefault();
		const from = event.clientX;
		const started = width;
		let landed = started;

		const move = (moved: PointerEvent) => {
			landed = withinReason(started + (from - moved.clientX));
			setWidth(landed);
		};
		const done = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", done);
			localStorage.setItem(remembered, String(landed));
		};

		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", done);
	}

	return (
		<aside
			style={{ width }}
			className="relative flex shrink-0 flex-col border-l border-border bg-surface"
		>
			<div
				role="separator"
				aria-orientation="vertical"
				aria-label="Resize the viewer"
				tabIndex={0}
				onPointerDown={drag}
				onKeyDown={(event) => {
					if (event.key === "ArrowLeft") resizeTo(width + 32);
					if (event.key === "ArrowRight") resizeTo(width - 32);
				}}
				className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-border focus-visible:bg-ring focus-visible:outline-none"
			/>
			<header className="flex items-center gap-2 border-b border-border py-2 pr-2 pl-4">
				<span className="min-w-0 flex-1 truncate text-sm font-medium" title={path}>
					{path}
				</span>
				<Button variant="ghost" size="icon-sm" aria-label="Close the viewer" onClick={onClose}>
					<X />
				</Button>
			</header>

			<div className="min-h-0 flex-1 overflow-auto p-4">
				<Shown view={view} />
			</div>
		</aside>
	);
}

function Shown({ view }: { view?: SandboxView }) {
	if (view === undefined) {
		return (
			<p className="flex items-center gap-2 text-sm text-muted-foreground">
				<Spinner />
				Reading…
			</p>
		);
	}

	switch (view.kind) {
		case "missing":
			return <p className="text-sm text-muted-foreground">Nothing is there any more.</p>;
		case "binary":
			return <p className="text-sm text-muted-foreground">{describe(view.bytes)} of something not text.</p>;
		case "directory":
			return view.entries.length === 0 ? (
				<p className="text-sm text-muted-foreground">An empty directory.</p>
			) : (
				<ul className="flex flex-col gap-1 text-sm">
					{view.entries.map((entry) => (
						<li key={entry} className="truncate">
							{entry}
						</li>
					))}
				</ul>
			);
		case "text":
			return (
				<div className="flex flex-col gap-3">
					{isMarkdown(view.path) ? (
						<Markdown content={view.content} />
					) : (
						<pre className="text-xs whitespace-pre-wrap">{view.content}</pre>
					)}
					{view.truncated && <p className="text-xs text-muted-foreground">Shown to the first 256 KB.</p>}
				</div>
			);
	}
}

const remembered = "agentos.viewer.width";
const narrowest = 320;

function rememberedWidth(): number {
	return withinReason(Number(localStorage.getItem(remembered)) || 560);
}

/** Wide enough to read a document, never so wide the thread it belongs to disappears. */
function withinReason(width: number): number {
	return Math.min(Math.max(width, narrowest), Math.round(window.innerWidth * 0.7));
}

function isMarkdown(path: string): boolean {
	return /\.(md|markdown)$/i.test(path);
}

function describe(bytes: number): string {
	return bytes < 1024 ? `${bytes} bytes` : `${Math.round(bytes / 1024)} KB`;
}
