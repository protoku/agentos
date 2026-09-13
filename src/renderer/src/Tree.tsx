import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, File } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { SandboxEntry } from "../../shared/api";

/** The sandbox as a tree: a folder is read when it opens, and read again as calls settle. */
export function Tree({
	workspaceId,
	conversationId,
	selected,
	version,
	onPick,
}: {
	workspaceId: string;
	conversationId: string;
	/** The path open in the viewer, which the tree opens down to; empty while nothing is open. */
	selected: string;
	/** Bumped by the thread as calls settle, since a call may have added or removed a name. */
	version: number;
	onPick: (path: string) => void;
}) {
	const [opened, setOpened] = useState<string[]>([root]);
	const [entries, setEntries] = useState<Record<string, SandboxEntry[]>>({});

	// A path from a call is shown where it sits, so the folders above it are opened for it.
	useEffect(() => {
		setOpened((current) => [...new Set([...current, ...foldersAbove(selected)])]);
	}, [selected]);

	// Another conversation is another sandbox: nothing read of the last one carries over.
	useEffect(() => {
		setOpened([root]);
		setEntries({});
	}, [workspaceId, conversationId]);

	const reading = opened.join("\n");
	useEffect(() => {
		let current = true;

		void Promise.all(
			opened.map(async (path) => {
				const view = await window.agentOS.viewSandboxPath(workspaceId, conversationId, path);

				return [path, view] as const;
			}),
		).then((read) => {
			if (!current) return;

			setEntries(
				Object.fromEntries(read.map(([path, view]) => [path, view.kind === "directory" ? view.entries : []])),
			);
		});

		return () => void (current = false);
		// The open folders are what is read, and a settled call is why they are read again.
	}, [workspaceId, conversationId, reading, version]);

	function rows(path: string, depth: number): React.ReactNode[] {
		return (entries[path] ?? []).flatMap((entry) => {
			const full = path === root ? entry.name : `${path}/${entry.name}`;
			const open = opened.includes(full);

			return [
				<button
					key={full}
					type="button"
					title={full}
					onClick={() => (entry.directory ? toggle(full) : onPick(full))}
					style={{ paddingLeft: `${depth * 0.75 + 0.25}rem` }}
					className={cn(
						"flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left text-xs",
						full === selected
							? "bg-accent text-accent-foreground"
							: "text-muted-foreground hover:bg-muted hover:text-foreground",
					)}
				>
					{entry.directory ? (
						open ? (
							<ChevronDown className="size-3.5 shrink-0" />
						) : (
							<ChevronRight className="size-3.5 shrink-0" />
						)
					) : (
						<File className="size-3.5 shrink-0 opacity-60" />
					)}
					<span className="truncate">{entry.name}</span>
				</button>,
				...(entry.directory && open ? rows(full, depth + 1) : []),
			];
		});
	}

	function toggle(path: string) {
		setOpened((current) => (current.includes(path) ? current.filter((open) => open !== path) : [...current, path]));
	}

	if (entries[root] === undefined) {
		return (
			<p className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
				<Spinner />
				Reading…
			</p>
		);
	}

	return entries[root].length === 0 ? (
		<p className="px-2 py-1 text-xs text-muted-foreground">Nothing in the sandbox yet.</p>
	) : (
		<div className="flex flex-col gap-0.5">{rows(root, 0)}</div>
	);
}

/** The sandbox itself, which is the one folder always open. */
const root = "";

function foldersAbove(path: string): string[] {
	const names = path.split("/").slice(0, -1);

	return names.map((_, index) => names.slice(0, index + 1).join("/"));
}
