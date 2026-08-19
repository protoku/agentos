import { useEffect, useState } from "react";
import { GitCompare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Nothing } from "./Nothing";
import { thousands } from "./format";
import type { SandboxDiff } from "../../shared/api";

/** What a mount has changed, read as a diff rather than as one file at a time. */
export function Diff({
	workspaceId,
	conversationId,
	path,
	version,
	onClose,
}: {
	workspaceId: string;
	conversationId: string;
	path: string;
	version: number;
	onClose: () => void;
}) {
	const [changes, setChanges] = useState<SandboxDiff>();
	const [failure, setFailure] = useState<string>();

	useEffect(() => {
		let current = true;
		setChanges(undefined);
		setFailure(undefined);

		void window.agentOS.sandboxDiff(workspaceId, conversationId, path).then(
			(found) => current && setChanges(found),
			(reason: Error) => current && setFailure(reason.message),
		);

		return () => void (current = false);
	}, [workspaceId, conversationId, path, version]);

	const empty = changes !== undefined && changes.diff.trim().length === 0 && changes.untracked.length === 0;

	return (
		<>
			<header className="flex items-center gap-2 border-b border-border py-2 pr-2 pl-4">
				<GitCompare className="size-4 shrink-0 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate text-sm font-medium">{path}</span>
				<Button variant="ghost" size="icon-sm" aria-label="Close the viewer" onClick={onClose}>
					<X />
				</Button>
			</header>

			<div className="min-h-0 flex-1 overflow-auto p-4">
				{failure && <p className="text-sm text-destructive">{failure}</p>}

				{changes === undefined && failure === undefined && (
					<p className="flex items-center gap-2 text-sm text-muted-foreground">
						<Spinner />
						Reading…
					</p>
				)}

				{empty && (
					<Nothing icon={<GitCompare />} title="Nothing changed yet">
						What the working tree has that its last commit does not will appear here.
					</Nothing>
				)}

				{changes && !empty && (
					<div className="flex flex-col gap-4">
						<DiffLines diff={changes.diff} />

						{changes.untracked.length > 0 && (
							<div className="flex flex-col gap-1 border-t border-border pt-3">
								<span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
									Never committed
								</span>
								{changes.untracked.map((name) => (
									<span key={name} className="truncate text-xs text-success">
										{name}
									</span>
								))}
							</div>
						)}
					</div>
				)}
			</div>
		</>
	);
}

/** A diff read as a diff, wherever it is shown: the viewer whole, a tool call up to a limit. */
export function DiffLines({ diff, limit }: { diff: string; limit?: number }) {
	const lines = diff.split("\n");
	const shown = limit === undefined ? lines : lines.slice(0, limit);

	return (
		<div className="flex min-w-0 flex-col gap-1">
			<pre className="overflow-x-auto text-xs leading-relaxed">
				{shown.map((line, index) => (
					<div key={index} className={colour(line)}>
						{line === "" ? " " : line}
					</div>
				))}
			</pre>
			{lines.length > shown.length && (
				<span className="block text-right text-xs text-muted-foreground">
					{`${shown.length} of ${thousands(lines.length)} lines`}
				</span>
			)}
		</div>
	);
}

/** Additions green, deletions red, everything that is only structure kept out of the way. */
function colour(line: string): string {
	if (line.startsWith("+++") || line.startsWith("---")) return "text-muted-foreground";
	if (line.startsWith("+")) return "text-success";
	if (line.startsWith("-")) return "text-destructive";
	if (line.startsWith("@@")) return "text-pending";
	if (line.startsWith("diff --git") || line.startsWith("index ")) return "mt-3 font-medium text-foreground";

	return "text-muted-foreground";
}
