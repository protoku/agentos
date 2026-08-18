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
	if (call.toolId !== "mount" || call.output === undefined) return undefined;

	const { source, path, mode, readOnly, startedFrom } = call.output;
	const kind = sources.find((candidate) => candidate.name === source)?.type;
	const terms = [String(mode), readOnly === true ? "read-only" : undefined, from(startedFrom)].filter(
		(term) => term !== undefined,
	);

	return {
		verb: "mounted",
		rows: [
			{
				icon: kind === undefined ? <Boxes /> : icons[kind],
				text: `${String(source)} → ${String(path)}`,
				hint: terms.join(", "),
			},
		],
	};
}

function from(startedFrom: unknown): string | undefined {
	return typeof startedFrom === "string" ? `from ${startedFrom}` : undefined;
}
