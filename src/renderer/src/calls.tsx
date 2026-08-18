import { Boxes, File, Folder, FolderOpen, GitBranch, MessagesSquare } from "lucide-react";
import type { MountSource, ToolCall } from "../../shared/types";

const icons: Record<MountSource["type"], React.ReactNode> = {
	directory: <FolderOpen />,
	git: <GitBranch />,
	conversations: <MessagesSquare />,
};

/** How a call reads on one line, and what is worth seeing when that line is opened. */
export interface CallSummary {
	/** The tool as a thing it does: Mount, List files. */
	label: string;
	icon?: React.ReactNode;
	/** What it acted on. */
	subject?: string;
	/** What became of it, sitting at the far right. */
	hint?: string;
	rows?: { icon: React.ReactNode; text: string }[];
}

/**
 * What a settled built-in call did. A tool with no summary here keeps its input and output as
 * they are, which is what every script tool does: only its shape is known, never its meaning.
 */
export function summarise(call: ToolCall, sources: MountSource[]): CallSummary | undefined {
	// A call that failed has no output, and what it was trying to do is still worth reading.
	return summaries[call.toolId]?.({ ...call.input, ...call.output }, sources);
}

type Summary = (output: Record<string, unknown>, sources: MountSource[]) => CallSummary;

const summaries: Record<string, Summary> = {
	mount: ({ source, path, mode, readOnly, startedFrom }, sources) => ({
		label: "Mount",
		icon: iconFor(source, sources),
		subject: `${String(source)} → ${String(path)}`,
		hint: [String(mode), readOnly === true ? "read-only" : undefined, from(startedFrom)]
			.filter((term) => term !== undefined)
			.join(", "),
	}),
	list_files: ({ path, entries }) => {
		const listed = Array.isArray(entries) ? (entries as { name: string; type: string }[]) : [];
		const directories = listed.filter((entry) => entry.type === "directory");

		return {
			label: "List files",
			icon: <Folder />,
			subject: String(path),
			hint: counted(directories.length, listed.length),
			// Opening the line is worth something: the names, directories first.
			rows: [...directories, ...listed.filter((entry) => entry.type !== "directory")].map((entry) => ({
				icon: entry.type === "directory" ? <Folder /> : <File />,
				text: entry.name,
			})),
		};
	},
	unmount: ({ source, path, mode }, sources) => ({
		label: "Unmount",
		icon: iconFor(source, sources),
		subject: source === undefined ? String(path) : `${String(source)} at ${String(path)}`,
		// The isolated case is the destructive one: its worktree and its branches go with it.
		hint:
			mode === "isolated"
				? "isolated, worktree discarded"
				: mode === undefined
					? undefined
					: "the data behind it untouched",
	}),
};

function counted(directories: number, all: number): string {
	if (all === 0) return "empty";

	const files = all - directories;
	const parts = [
		directories > 0 ? `${directories} ${directories === 1 ? "directory" : "directories"}` : undefined,
		files > 0 ? `${files} ${files === 1 ? "file" : "files"}` : undefined,
	];

	return parts.filter((part) => part !== undefined).join(", ");
}

/** A tool with no summary of its own still gets its name back: git_create_branch, Git create branch. */
export function labelOf(toolId: string): string {
	const words = toolId.replace(/_/g, " ");

	return words.charAt(0).toUpperCase() + words.slice(1);
}

function iconFor(source: unknown, sources: MountSource[]): React.ReactNode {
	const kind = sources.find((candidate) => candidate.name === source)?.type;

	return kind === undefined ? <Boxes /> : icons[kind];
}

function from(startedFrom: unknown): string | undefined {
	return typeof startedFrom === "string" ? `from ${startedFrom}` : undefined;
}
