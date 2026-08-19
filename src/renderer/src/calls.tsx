import {
	Boxes,
	File,
	FilePen,
	FilePlus,
	FileText,
	FileX,
	Folder,
	FolderOpen,
	FolderX,
	GitBranch,
	GitCommitHorizontal,
	GitCompare,
	MessagesSquare,
	Search,
	Terminal,
	Wrench,
} from "lucide-react";
import { thousands } from "./format";
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
	read_file: ({ path, content }) => ({
		label: "Read file",
		icon: <FileText />,
		subject: String(path),
		hint: typeof content === "string" ? `${thousands(content.split("\n").length)} lines` : undefined,
	}),
	write_file: ({ path, bytes }) => ({
		label: "Write file",
		icon: <FilePlus />,
		subject: String(path),
		hint: typeof bytes === "number" ? `${thousands(bytes)} bytes` : undefined,
	}),
	edit_file: ({ path, bytes }) => ({
		label: "Edit file",
		icon: <FilePen />,
		subject: String(path),
		hint: typeof bytes === "number" ? `${thousands(bytes)} bytes after` : undefined,
	}),
	move_file: ({ from, to }) => ({
		label: "Move file",
		icon: <FilePen />,
		subject: `${String(from)} → ${String(to)}`,
	}),
	delete_file: ({ path }) => ({ label: "Delete file", icon: <FileX />, subject: String(path) }),
	delete_directory: ({ path, entries }) => ({
		label: "Delete directory",
		icon: <FolderX />,
		subject: String(path),
		hint: typeof entries === "number" && entries > 0 ? `${thousands(entries)} removed with it` : undefined,
	}),
	search_files: ({ pattern, path, matches, truncated }) => ({
		label: "Search files",
		icon: <Search />,
		subject: path === undefined ? String(pattern) : `${String(pattern)} in ${String(path)}`,
		hint: Array.isArray(matches)
			? `${matches.length}${truncated === true ? "+" : ""} ${matches.length === 1 ? "match" : "matches"}`
			: undefined,
		rows: Array.isArray(matches)
			? (matches as { path: string; line: number; text: string }[])
					.slice(0, 20)
					.map((match) => ({ icon: <FileText />, text: `${match.path}:${match.line}  ${match.text.trim()}` }))
			: undefined,
	}),
	git_status: ({ path, branch, ahead, behind, changes }) => ({
		label: "Git status",
		icon: <GitBranch />,
		subject: branch === undefined ? String(path) : `${String(path)} on ${String(branch)}`,
		hint: [
			Array.isArray(changes) ? `${changes.length} changed` : undefined,
			typeof ahead === "number" && ahead > 0 ? `${ahead} ahead` : undefined,
			typeof behind === "number" && behind > 0 ? `${behind} behind` : undefined,
		]
			.filter((term) => term !== undefined)
			.join(", "),
		rows: Array.isArray(changes)
			? (changes as { change: string; file: string }[]).map((change) => ({
					icon: <FileText />,
					text: `${change.change} ${change.file}`,
				}))
			: undefined,
	}),
	git_diff: ({ path, diff }) => ({
		label: "Git diff",
		icon: <GitCompare />,
		subject: String(path),
		hint: typeof diff === "string" ? changed(diff) : undefined,
	}),
	git_log: ({ path, commits }) => ({
		label: "Git log",
		icon: <GitCommitHorizontal />,
		subject: String(path),
		hint: Array.isArray(commits) ? `${commits.length} commits` : undefined,
		rows: Array.isArray(commits)
			? (commits as { hash: string; subject: string }[]).map((commit) => ({
					icon: <GitCommitHorizontal />,
					text: `${commit.hash.slice(0, 7)}  ${commit.subject}`,
				}))
			: undefined,
	}),
	git_create_branch: ({ path, branch, name }) => ({
		label: "Create branch",
		icon: <GitBranch />,
		subject: `${String(branch ?? name)} on ${String(path)}`,
	}),
	git_checkout: ({ path, branch, name }) => ({
		label: "Checkout",
		icon: <GitBranch />,
		subject: `${String(branch ?? name)} on ${String(path)}`,
	}),
	git_commit: ({ commit, message }) => ({
		label: "Commit",
		icon: <GitCommitHorizontal />,
		subject: String(message),
		hint: typeof commit === "string" ? commit.slice(0, 7) : undefined,
	}),
	git_pull: ({ path, branch, summary }) => ({
		label: "Pull",
		icon: <GitBranch />,
		subject: `${String(branch)} on ${String(path)}`,
		hint: typeof summary === "string" ? summary.split("\n")[0] : undefined,
	}),
	git_push: ({ path, branch }) => ({
		label: "Push",
		icon: <GitBranch />,
		subject: `${String(branch)} on ${String(path)} → origin`,
	}),
	run_command: ({ command, args, ok, exitCode }) => ({
		label: "Run",
		icon: <Terminal />,
		subject: [String(command), ...(Array.isArray(args) ? args.map(String) : [])].join(" "),
		hint: ok === true ? "ok" : typeof exitCode === "number" ? `exit ${exitCode}` : undefined,
	}),
	define_tool: ({ name }) => ({ label: "Define tool", icon: <Wrench />, subject: String(name) }),
	update_tool: ({ name, rename }) => ({
		label: "Update tool",
		icon: <Wrench />,
		subject: rename === undefined ? String(name) : `${String(name)} → ${String(rename)}`,
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

/** A diff's weight, in the two numbers anybody actually reads. */
function changed(diff: string): string {
	const lines = diff.split("\n");
	const added = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
	const removed = lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;

	return `+${added} −${removed}`;
}

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
