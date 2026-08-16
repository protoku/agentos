import { z } from "zod";
import { define, sandboxPath, type BuiltinToolImplementation, type ToolContext } from "./define";
import { mountedAt } from "./mounts";
import { git } from "../git/git";

const mountPath = sandboxPath.describe("Sandbox path of the git mount this acts on");
const logLimit = 20;
const field = "";

export const gitTools: BuiltinToolImplementation[] = [
	define({
		id: "git_status",
		description: "Show what changed on a git mount.",
		input: z.object({ path: mountPath }),
		outputSchema: {
			type: "object",
			properties: {
				path: { type: "string" },
				branch: { type: "string" },
				changes: {
					type: "array",
					items: {
						type: "object",
						properties: { change: { type: "string" }, file: { type: "string" } },
						required: ["change", "file"],
					},
				},
			},
			required: ["path", "changes"],
		},
		async run({ path }, context) {
			const { directory, branch } = await gitMount(context, path);
			const lines = (await git(["status", "--porcelain"], directory)).split("\n").filter((line) => line.length > 0);

			return {
				path,
				...(branch !== undefined && { branch }),
				changes: lines.map((line) => ({ change: line.slice(0, 2).trim(), file: line.slice(3) })),
			};
		},
	}),
	define({
		id: "git_diff",
		description: "Show a git mount's changes, staged and unstaged.",
		input: z.object({ path: mountPath }),
		outputSchema: {
			type: "object",
			properties: { path: { type: "string" }, diff: { type: "string" } },
			required: ["path", "diff"],
		},
		async run({ path }, context) {
			const { directory } = await gitMount(context, path);

			return { path, diff: await git(["diff", "HEAD"], directory) };
		},
	}),
	define({
		id: "git_log",
		description: `Show recent history of a git mount's branch, at most ${logLimit} commits.`,
		input: z.object({ path: mountPath, limit: z.number().int().positive().max(logLimit).default(logLimit) }),
		outputSchema: {
			type: "object",
			properties: {
				path: { type: "string" },
				commits: {
					type: "array",
					items: {
						type: "object",
						properties: {
							hash: { type: "string" },
							author: { type: "string" },
							date: { type: "string" },
							subject: { type: "string" },
						},
						required: ["hash", "author", "date", "subject"],
					},
				},
			},
			required: ["path", "commits"],
		},
		async run({ path, limit }, context) {
			const { directory } = await gitMount(context, path);
			const format = ["%H", "%an", "%aI", "%s"].join(field);
			const lines = (await git(["log", `--pretty=format:${format}`, `-n${limit}`], directory))
				.split("\n")
				.filter((line) => line.length > 0);

			return {
				path,
				commits: lines.map((line) => {
					const [hash, author, date, subject] = line.split(field);

					return { hash, author, date, subject };
				}),
			};
		},
	}),
];

/** A git tool names its mount by sandbox path, since several repositories can be mounted at once. */
async function gitMount(context: ToolContext, path: string): Promise<{ directory: string; branch?: string }> {
	const found = await mountedAt(context, path);
	if (found === undefined) throw new Error(`Nothing is mounted at ${path}`);
	if (found.source?.type !== "git") throw new Error(`${path} is not a git mount`);

	return { directory: found.directory, branch: await found.branch() };
}
