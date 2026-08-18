import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { z } from "zod";
import { define, sandboxPath, type BuiltinToolImplementation } from "./define";
import { authoringTools } from "./authoring";
import { gitTools } from "./gitTools";
import { mountTools, resolveWritable } from "./mounts";
import { resolveInSandbox } from "./sandbox";
import { git } from "../git/git";
import type { BuiltinTool } from "../../shared/types";

const searchLimit = 100;

const fileTools: BuiltinToolImplementation[] = [
	define({
		id: "write_file",
		description: "Create a file, replacing it if it already exists.",
		input: z.object({ path: sandboxPath, content: z.string() }),
		outputSchema: {
			type: "object",
			properties: { path: { type: "string" }, bytes: { type: "number" } },
			required: ["path", "bytes"],
		},
		async run({ path, content }, context) {
			const file = await resolveWritable(context, path);

			await mkdir(dirname(file), { recursive: true });
			await writeFile(file, content, "utf8");

			return { path, bytes: Buffer.byteLength(content, "utf8") };
		},
	}),
	define({
		id: "read_file",
		description: "Read a file.",
		input: z.object({ path: sandboxPath }),
		outputSchema: {
			type: "object",
			properties: { path: { type: "string" }, content: { type: "string" } },
			required: ["path", "content"],
		},
		async run({ path }, { sandbox }) {
			return { path, content: await readFile(resolveInSandbox(sandbox, path), "utf8") };
		},
	}),
	define({
		id: "list_files",
		description: "List the files and directories under a path.",
		input: z.object({ path: sandboxPath.default(".") }),
		outputSchema: {
			type: "object",
			properties: {
				path: { type: "string" },
				entries: {
					type: "array",
					items: {
						type: "object",
						properties: { name: { type: "string" }, type: { enum: ["file", "directory"] } },
						required: ["name", "type"],
					},
				},
			},
			required: ["path", "entries"],
		},
		async run({ path }, { sandbox }) {
			const found = await readdir(resolveInSandbox(sandbox, path), { withFileTypes: true });

			return {
				path,
				entries: found.map((entry) => ({
					name: entry.name,
					type: entry.isDirectory() ? "directory" : "file",
				})),
			};
		},
	}),
	define({
		id: "edit_file",
		description: "Change a file by replacing a snippet that must appear exactly once.",
		input: z.object({ path: sandboxPath, find: z.string(), replace: z.string() }),
		outputSchema: {
			type: "object",
			properties: { path: { type: "string" }, bytes: { type: "number" } },
			required: ["path", "bytes"],
		},
		async run({ path, find, replace }, context) {
			const file = await resolveWritable(context, path);
			const before = await readFile(file, "utf8");

			const occurrences = before.split(find).length - 1;
			if (occurrences !== 1) throw new Error(`Snippet appears ${occurrences} times in ${path}, expected once`);

			const after = before.replace(find, replace);
			await writeFile(file, after, "utf8");

			return { path, bytes: Buffer.byteLength(after, "utf8") };
		},
	}),
	define({
		id: "move_file",
		description: "Move or rename a file. Refuses to overwrite what is already there.",
		input: z.object({ from: sandboxPath, to: sandboxPath }),
		outputSchema: {
			type: "object",
			properties: { from: { type: "string" }, to: { type: "string" } },
			required: ["from", "to"],
		},
		async run({ from, to }, context) {
			const target = await resolveWritable(context, to);
			const source = await resolveWritable(context, from);

			if (await exists(target)) throw new Error(`${to} already exists`);

			await mkdir(dirname(target), { recursive: true });
			await rename(source, target);

			return { from, to };
		},
	}),
	define({
		id: "delete_file",
		description: "Remove a file. Directories are refused.",
		input: z.object({ path: sandboxPath }),
		outputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
		async run({ path }, context) {
			const file = await resolveWritable(context, path);

			if ((await stat(file)).isDirectory()) throw new Error(`${path} is a directory`);
			await unlink(file);

			return { path };
		},
	}),
	define({
		id: "search_files",
		description: `Search file contents by regular expression, returning at most ${searchLimit} matches.`,
		input: z.object({ pattern: z.string(), path: sandboxPath.default(".") }),
		outputSchema: {
			type: "object",
			properties: {
				pattern: { type: "string" },
				truncated: { type: "boolean" },
				matches: {
					type: "array",
					items: {
						type: "object",
						properties: {
							path: { type: "string" },
							line: { type: "number" },
							text: { type: "string" },
						},
						required: ["path", "line", "text"],
					},
				},
			},
			required: ["pattern", "matches", "truncated"],
		},
		async run(input, { sandbox }) {
			const pattern = new RegExp(input.pattern);
			const root = resolveInSandbox(sandbox, input.path);
			const matches: { path: string; line: number; text: string }[] = [];

			for (const file of await searchable(root)) {
				if (matches.length > searchLimit) break;

				const content = await readFile(file, "utf8").catch(() => undefined);
				if (content === undefined) continue;

				for (const [index, line] of content.split("\n").entries()) {
					if (pattern.test(line)) matches.push({ path: relative(sandbox, file), line: index + 1, text: line });
				}
			}

			return { pattern: pattern.source, truncated: matches.length > searchLimit, matches: matches.slice(0, searchLimit) };
		},
	}),
];

export const builtinTools: BuiltinToolImplementation[] = [
	...fileTools,
	...mountTools,
	...gitTools,
	...authoringTools,
];

/** The metadata alone, since run and input carry functions and IPC cannot carry one. */
export function builtinToolMetadata(): BuiltinTool[] {
	return builtinTools.map(({ run, input, ...tool }) => tool);
}

export function builtinTool(toolId: string): BuiltinToolImplementation {
	const tool = builtinTools.find((candidate) => candidate.id === toolId);
	if (tool === undefined) throw new Error(`No tool ${toolId}`);

	return tool;
}

/**
 * What a search is allowed to see. Inside a checkout that is whatever git would show you, which
 * is the one definition of ignored that a repository already agrees on; anywhere else it is
 * everything, minus the two directories nobody means to search.
 */
async function searchable(root: string): Promise<string[]> {
	const listed = await git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"], root).catch(
		() => undefined,
	);

	if (listed !== undefined) {
		return listed
			.split("\0")
			.filter((path) => path.length > 0)
			.map((path) => join(root, path));
	}

	const found = await readdir(root, { recursive: true, withFileTypes: true });

	return found
		.filter((entry) => entry.isFile() && !ignoredEverywhere(entry.parentPath))
		.map((entry) => join(entry.parentPath, entry.name));
}

function ignoredEverywhere(path: string): boolean {
	return path.split(sep).some((part) => part === ".git" || part === "node_modules");
}

async function exists(path: string): Promise<boolean> {
	return stat(path).then(
		() => true,
		() => false,
	);
}
