import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveInSandbox } from "./sandbox";
import type { BuiltinTool } from "../../shared/types";

export interface BuiltinToolImplementation extends BuiltinTool {
	run(input: Record<string, unknown>, sandbox: string): Promise<Record<string, unknown>>;
}

const pathProperty = { type: "string", description: "Path relative to the sandbox" };

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
];

export function builtinTool(toolId: string): BuiltinToolImplementation {
	const tool = builtinTools.find((candidate) => candidate.id === toolId);
	if (tool === undefined) throw new Error(`No tool ${toolId}`);

	return tool;
}

function text(input: Record<string, unknown>, key: string): string {
	const value = input[key];
	if (typeof value !== "string") throw new Error(`${key} must be a string`);

	return value;
}
