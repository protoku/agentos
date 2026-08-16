import { z } from "zod";
import { define, sandboxPath, type BuiltinToolImplementation, type ToolContext } from "./define";
import { mountedAt } from "./mounts";
import { createBranchTool } from "../git/branches";
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
	define({
		id: createBranchTool,
		description: "Create a branch on an isolated git mount and switch the mount onto it.",
		input: z.object({ path: mountPath, name: z.string().describe("Branch to create") }),
		outputSchema: {
			type: "object",
			properties: { path: { type: "string" }, branch: { type: "string" } },
			required: ["path", "branch"],
		},
		async run({ path, name }, context) {
			const { directory } = await gitMount(context, path, { writable: true, isolated: true });
			await git(["checkout", "-b", name], directory);

			return { path, branch: name };
		},
	}),
	define({
		id: "git_commit",
		description: "Commit everything that changed on a git mount.",
		input: z.object({ path: mountPath, message: z.string().describe("Commit message") }),
		outputSchema: {
			type: "object",
			properties: {
				path: { type: "string" },
				branch: { type: "string" },
				commit: { type: "string" },
				message: { type: "string" },
			},
			required: ["path", "branch", "commit", "message"],
		},
		async run({ path, message }, context) {
			const { directory, branch } = await gitMount(context, path, { writable: true, branch: true });

			await git(["add", "-A"], directory);
			await git(["commit", "-m", message], directory);

			return { path, branch, commit: (await git(["rev-parse", "HEAD"], directory)).trim(), message };
		},
	}),
	define({
		id: "git_pull",
		description: "Pull a git mount's branch from its remote.",
		input: z.object({ path: mountPath }),
		outputSchema: {
			type: "object",
			properties: { path: { type: "string" }, branch: { type: "string" }, summary: { type: "string" } },
			required: ["path", "branch", "summary"],
		},
		async run({ path }, context) {
			const { directory, branch } = await gitMount(context, path, { writable: true, branch: true });
			if ((await upstreamOf(directory)) === undefined) {
				throw new Error(`${branch} has never been pushed, so there is nothing to pull from yet`);
			}

			return { path, branch, summary: (await git(["pull"], directory)).trim() };
		},
	}),
	define({
		id: "git_push",
		description: "Push a git mount's branch to its remote, setting its upstream the first time.",
		input: z.object({ path: mountPath }),
		outputSchema: {
			type: "object",
			properties: { path: { type: "string" }, branch: { type: "string" }, summary: { type: "string" } },
			required: ["path", "branch", "summary"],
		},
		async run({ path }, context) {
			const { directory, branch } = await gitMount(context, path, { writable: true, branch: true });
			const summary = await git(["push", "--porcelain", "--set-upstream", "origin", String(branch)], directory);

			return { path, branch, summary: summary.trim() };
		},
	}),
];

interface Needs {
	/** A read-only mount is for reading: the mutating git tools are unavailable on it. */
	writable?: boolean;
	/** Only an isolated mount branches: a shared checkout never leaves its default branch. */
	isolated?: boolean;
	branch?: boolean;
}

/** A git tool names its mount by sandbox path, since several repositories can be mounted at once. */
async function gitMount(
	context: ToolContext,
	path: string,
	needs: Needs = {},
): Promise<{ directory: string; branch?: string }> {
	const found = await mountedAt(context, path);
	if (found === undefined) throw new Error(`Nothing is mounted at ${path}`);
	if (found.source?.type !== "git") throw new Error(`${path} is not a git mount`);

	if (needs.writable === true && found.mount.readOnly) throw new Error(`${path} is mounted read-only`);
	if (needs.isolated === true && found.mount.mode !== "isolated") {
		throw new Error(`${path} is a shared mount, which never leaves its default branch`);
	}

	const branch = await found.branch();
	if (needs.branch === true && branch === undefined) throw new Error(`${path} is on no branch: create one first`);

	return { directory: found.directory, branch };
}

async function upstreamOf(directory: string): Promise<string | undefined> {
	return git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], directory).then(
		(name) => name.trim(),
		() => undefined,
	);
}
