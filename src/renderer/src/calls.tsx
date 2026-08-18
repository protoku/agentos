import { Boxes, FolderOpen, GitBranch, MessagesSquare } from "lucide-react";
import type { MountSource, ToolCall } from "../../shared/types";

const icons: Record<MountSource["type"], React.ReactNode> = {
	directory: <FolderOpen className="size-3.5" />,
	git: <GitBranch className="size-3.5" />,
	conversations: <MessagesSquare className="size-3.5" />,
};

/**
 * What a settled built-in call did, in a line. A tool whose output has no summary here keeps its
 * input and output as they are, which is what every script tool does: only its shape is known.
 */
export function summarise(call: ToolCall, sources: MountSource[]): React.ReactNode | undefined {
	if (call.toolId !== "mount" || call.output === undefined) return undefined;

	const { source, path, mode, readOnly, startedFrom } = call.output;
	const kind = sources.find((candidate) => candidate.name === source)?.type;
	const terms = [String(mode), readOnly === true ? "read-only" : undefined, from(startedFrom)].filter(
		(term) => term !== undefined,
	);

	return (
		<span className="flex min-w-0 items-center gap-2 text-sm">
			{kind === undefined ? <Boxes className="size-3.5" /> : icons[kind]}
			<span className="truncate">
				{String(source)} → {String(path)}
			</span>
			<span className="shrink-0 text-xs text-muted-foreground">({terms.join(", ")})</span>
		</span>
	);
}

function from(startedFrom: unknown): string | undefined {
	return typeof startedFrom === "string" ? `from ${startedFrom}` : undefined;
}
