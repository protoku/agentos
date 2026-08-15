import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { resolveInSandbox } from "./sandbox";
import type { BuiltinTool } from "../../shared/types";

export interface BuiltinToolImplementation extends BuiltinTool {
	run(input: Record<string, unknown>, sandbox: string): Promise<Record<string, unknown>>;
}

const pathProperty = { type: "string", description: "Path relative to the sandbox" };
const searchLimit = 100;

export const builtinTools: BuiltinToolImplementation[] = [
	{
		type: "builtin",
		id: "write_file",
		name: "write_file",
		description: "Create a file, replacing it if it already exists.",
		inputSchema: {
			type: "object",
			properties: { path: pathProperty, content: { type: "string" } },
			required: ["path", "content"],
		},
		outputSchema: {
			type: "object",
			properties: { path: { type: "string" }, bytes: { type: "number" } },
			required: ["path", "bytes"],
		},
		async run(input, sandbox) {
			const path = text(input, "path");
			const content = text(input, "content");
			const file = resolveInSandbox(sandbox, path);

			await mkdir(dirname(file), { recursive: true });
			await writeFile(file, content, "utf8");

			return { path, bytes: Buffer.byteLength(content, "utf8") };
		},
	},
	{
		type: "builtin",
		id: "read_file",
		name: "read_file",
		description: "Read a file.",
		inputSchema: { type: "object", properties: { path: pathProperty }, required: ["path"] },
		outputSchema: {
			type: "object",
			properties: { path: { type: "string" }, content: { type: "string" } },
			required: ["path", "content"],
		},
		async run(input, sandbox) {
			const path = text(input, "path");

			return { path, content: await readFile(resolveInSandbox(sandbox, path), "utf8") };
		},
	},
	{
		type: "builtin",
		id: "list_files",
		name: "list_files",
		description: "List the files and directories under a path.",
		inputSchema: { type: "object", properties: { path: pathProperty } },
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
		async run(input, sandbox) {
			const path = input.path === undefined ? "." : text(input, "path");
			const found = await readdir(resolveInSandbox(sandbox, path), { withFileTypes: true });

			return {
				path,
				entries: found.map((entry) => ({
					name: entry.name,
					type: entry.isDirectory() ? "directory" : "file",
				})),
			};
		},
	},
	{
		type: "builtin",
		id: "edit_file",
		name: "edit_file",
		description: "Change a file by replacing a snippet that must appear exactly once.",
		inputSchema: {
			type: "object",
			properties: { path: pathProperty, find: { type: "string" }, replace: { type: "string" } },
			required: ["path", "find", "replace"],
		},
		outputSchema: {
			type: "object",
			properties: { path: { type: "string" }, bytes: { type: "number" } },
			required: ["path", "bytes"],
		},
		async run(input, sandbox) {
			const path = text(input, "path");
			const find = text(input, "find");
			const file = resolveInSandbox(sandbox, path);
			const before = await readFile(file, "utf8");

			const occurrences = before.split(find).length - 1;
			if (occurrences !== 1) throw new Error(`Snippet appears ${occurrences} times in ${path}, expected once`);

			const after = before.replace(find, text(input, "replace"));
			await writeFile(file, after, "utf8");

			return { path, bytes: Buffer.byteLength(after, "utf8") };
		},
	},
	{
		type: "builtin",
		id: "move_file",
		name: "move_file",
		description: "Move or rename a file. Refuses to overwrite what is already there.",
		inputSchema: {
			type: "object",
			properties: { from: pathProperty, to: pathProperty },
			required: ["from", "to"],
		},
		outputSchema: {
			type: "object",
			properties: { from: { type: "string" }, to: { type: "string" } },
			required: ["from", "to"],
		},
		async run(input, sandbox) {
			const from = text(input, "from");
			const to = text(input, "to");
			const target = resolveInSandbox(sandbox, to);

			if (await exists(target)) throw new Error(`${to} already exists`);

			await mkdir(dirname(target), { recursive: true });
			await rename(resolveInSandbox(sandbox, from), target);

			return { from, to };
		},
	},
	{
		type: "builtin",
		id: "delete_file",
		name: "delete_file",
		description: "Remove a file. Directories are refused.",
		inputSchema: { type: "object", properties: { path: pathProperty }, required: ["path"] },
		outputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
		async run(input, sandbox) {
			const path = text(input, "path");
			const file = resolveInSandbox(sandbox, path);

			if ((await stat(file)).isDirectory()) throw new Error(`${path} is a directory`);
			await unlink(file);

			return { path };
		},
	},
	{
		type: "builtin",
		id: "search_files",
		name: "search_files",
		description: `Search file contents by regular expression, returning at most ${searchLimit} matches.`,
		inputSchema: {
			type: "object",
			properties: { pattern: { type: "string" }, path: pathProperty },
			required: ["pattern"],
		},
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
		async run(input, sandbox) {
			const pattern = new RegExp(text(input, "pattern"));
			const root = resolveInSandbox(sandbox, input.path === undefined ? "." : text(input, "path"));
			const matches: { path: string; line: number; text: string }[] = [];

			for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
				if (!entry.isFile() || matches.length > searchLimit) continue;

				const file = join(entry.parentPath, entry.name);
				const content = await readFile(file, "utf8").catch(() => undefined);
				if (content === undefined) continue;

				for (const [index, line] of content.split("\n").entries()) {
					if (pattern.test(line)) matches.push({ path: relative(sandbox, file), line: index + 1, text: line });
				}
			}

			return { pattern: pattern.source, truncated: matches.length > searchLimit, matches: matches.slice(0, searchLimit) };
		},
	},
];

/** The metadata alone, since run is a function and IPC cannot carry one. */
export function builtinToolMetadata(): BuiltinTool[] {
	return builtinTools.map(({ run, ...tool }) => tool);
}

export function builtinTool(toolId: string): BuiltinToolImplementation {
	const tool = builtinTools.find((candidate) => candidate.id === toolId);
	if (tool === undefined) throw new Error(`No tool ${toolId}`);

	return tool;
}

async function exists(path: string): Promise<boolean> {
	return stat(path).then(
		() => true,
		() => false,
	);
}

function text(input: Record<string, unknown>, key: string): string {
	const value = input[key];
	if (typeof value !== "string") throw new Error(`${key} must be a string`);

	return value;
}
