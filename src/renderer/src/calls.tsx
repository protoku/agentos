import { Boxes, FolderOpen, GitBranch, MessagesSquare } from "lucide-react";
import type { MountSource, ToolCall } from "../../shared/types";

const icons: Record<MountSource["type"], React.ReactNode> = {
	directory: <FolderOpen />,
	git: <GitBranch />,
	conversations: <MessagesSquare />,
};

/** What a call did, said as rows: what happened, then what it happened to. */
export interface CallSummary {
	/** Past tense, and subjectless: whoever made the call is put in front of it. */
	verb: string;
	rows: { icon: React.ReactNode; text: string; hint?: string }[];
}

/**
 * What a settled built-in call did. A tool with no summary here keeps its input and output as
 * they are, which is what every script tool does: only its shape is known, never its meaning.
 */
export function summarise(call: ToolCall, sources: MountSource[]): CallSummary | undefined {
	if (call.output === undefined) return undefined;

	return summaries[call.toolId]?.(call.output, sources);
}

type Summary = (output: Record<string, unknown>, sources: MountSource[]) => CallSummary;

const summaries: Record<string, Summary> = {
	mount: ({ source, path, mode, readOnly, startedFrom }, sources) => ({
		verb: "mounted",
		rows: [
			{
				icon: iconFor(source, sources),
				text: `${String(source)} → ${String(path)}`,
				hint: [String(mode), readOnly === true ? "read-only" : undefined, from(startedFrom)]
					.filter((term) => term !== undefined)
					.join(", "),
			},
		],
	}),
	unmount: ({ source, path, mode }, sources) => ({
		verb: "unmounted",
		rows: [
			{
				icon: iconFor(source, sources),
				text: `${String(source)} at ${String(path)}`,
				// The isolated case is the destructive one: its worktree and its branches go with it.
				hint: mode === "isolated" ? "isolated, worktree discarded" : "the data behind it untouched",
			},
		],
	}),
};

function iconFor(source: unknown, sources: MountSource[]): React.ReactNode {
	const kind = sources.find((candidate) => candidate.name === source)?.type;

	return kind === undefined ? <Boxes /> : icons[kind];
}

function from(startedFrom: unknown): string | undefined {
	return typeof startedFrom === "string" ? `from ${startedFrom}` : undefined;
}
