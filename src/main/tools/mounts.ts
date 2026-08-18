import { mkdir, stat, symlink, unlink } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";
import { z } from "zod";
import { define, sandboxPath, type BuiltinToolImplementation, type ToolTarget } from "./define";
import { resolveInSandbox } from "./sandbox";
import { branchesCreatedOn, deleteBranches } from "../git/branches";
import { baseClonePath, ensureBaseClone, gitConfigOf } from "../git/clone";
import { git } from "../git/git";
import { addWorktree, currentBranch, removeWorktree } from "../git/worktree";
import { readEntries } from "../storage/conversationFile";
import { conversationFile, conversationsDirectory, loadWorkspace, saveWorkspace } from "../storage/workspaceStore";
import type { Conversation, Mount, MountSource, Workspace } from "../../shared/types";

const mountPath = sandboxPath.describe("Where in the sandbox the source is attached");

export const mountTools: BuiltinToolImplementation[] = [
	define({
		id: "mount",
		description: "Attach a workspace mount source into the sandbox at a path.",
		input: z.object({
			source: z.string().describe("Name of the workspace mount source"),
			path: mountPath,
			mode: z.enum(["shared", "isolated"]).optional().describe("Shared unless asked otherwise"),
			readOnly: z.boolean().optional(),
		}),
		outputSchema: {
			type: "object",
			properties: {
				source: { type: "string" },
				path: { type: "string" },
				mode: { enum: ["shared", "isolated"] },
				readOnly: { type: "boolean" },
				startedFrom: { type: "string", description: "Which tip an isolated worktree began at" },
			},
			required: ["source", "path", "mode", "readOnly"],
		},
		async run({ source: name, path, ...asked }, context) {
			const { workspace, conversation } = await open(context);
			const source = workspace.sources.find((candidate) => candidate.name === name);
			if (source === undefined) throw new Error(`No source ${name}`);

			const { mode, readOnly } = settle(source, asked);

			refuseCollision(conversation.mounts, path);
			const startedFrom = await attach(context, source, mode, resolveInSandbox(context.sandbox, path));

			const mount: Mount = { sourceId: source.id, path, mode, readOnly, createdAt: new Date().toISOString() };
			conversation.mounts.push(mount);
			await saveWorkspace(context.root, workspace);

			return { source: name, path, mode, readOnly, ...(startedFrom !== undefined && { startedFrom }) };
		},
	}),
	define({
		id: "unmount",
		description: "Detach a mount, leaving the data behind it untouched.",
		input: z.object({ path: mountPath }),
		outputSchema: {
			type: "object",
			properties: { source: { type: "string" }, path: { type: "string" } },
			required: ["source", "path"],
		},
		async run({ path }, context) {
			const { workspace, conversation } = await open(context);
			const mount = conversation.mounts.find((candidate) => candidate.path === path);
			if (mount === undefined) throw new Error(`Nothing is mounted at ${path}`);

			await detach(context, mount, resolveInSandbox(context.sandbox, path));

			// The mounts list is current state: the record of what happened is this call in the thread.
			conversation.mounts = conversation.mounts.filter((candidate) => candidate !== mount);
			await saveWorkspace(context.root, workspace);

			return { source: nameOf(workspace, mount.sourceId), path };
		},
	}),
];

/**
 * Where a built-in tool is allowed to change something: inside the sandbox, and not inside a
 * mount the conversation took read-only. Mounts come from the record on every call, since a
 * turn can mount and unmount while it runs.
 */
export async function resolveWritable(context: ToolTarget, path: string): Promise<string> {
	const target = resolveInSandbox(context.sandbox, path);
	const { conversation } = await open(context);

	for (const mount of conversation.mounts) {
		const root = resolveInSandbox(context.sandbox, mount.path);
		if (target !== root && !isInside(target, root)) continue;

		if (mount.readOnly) throw new Error(`${mount.path} is mounted read-only`);
		// Work never begins on the default branch itself, so an isolated mount waits for a branch.
		if (mount.mode === "isolated" && (await currentBranch(root)) === undefined) {
			throw new Error(`${mount.path} is on no branch: create one before changing it`);
		}
	}

	return target;
}

export interface MountedAt {
	mount: Mount;
	source?: MountSource;
	directory: string;
	branch(): Promise<string | undefined>;
}

/** What sits at a sandbox path, which is how a git tool names the repository it acts on. */
export async function mountedAt(context: ToolTarget, path: string): Promise<MountedAt | undefined> {
	const { workspace, conversation } = await open(context);
	const mount = conversation.mounts.find((candidate) => candidate.path === path);
	if (mount === undefined) return undefined;

	const directory = resolveInSandbox(context.sandbox, path);

	return {
		mount,
		source: workspace.sources.find((candidate) => candidate.id === mount.sourceId),
		directory,
		branch: () => currentBranch(directory),
	};
}

async function open(context: ToolTarget): Promise<{ workspace: Workspace; conversation: Conversation }> {
	const workspace = await loadWorkspace(context.root, context.workspaceId);
	const conversation = workspace.conversations.find((candidate) => candidate.id === context.conversationId);
	if (conversation === undefined) throw new Error(`No conversation ${context.conversationId}`);

	return { workspace, conversation };
}

/**
 * What the mount ends up being: asked for, defaulted, or fixed by the source. A conversations
 * mount is the workspace reading its own threads, so its terms are not the caller's to choose.
 */
function settle(
	source: MountSource,
	asked: { mode?: Mount["mode"]; readOnly?: boolean },
): { mode: Mount["mode"]; readOnly: boolean } {
	if (source.type === "conversations") {
		if (asked.mode === "isolated") throw new Error("A conversations mount is always shared");
		if (asked.readOnly === false) throw new Error("A conversations mount is always read-only");

		return { mode: "shared", readOnly: true };
	}

	// Only a git source has branching to build an isolated checkout from.
	if (asked.mode === "isolated" && source.type !== "git") throw new Error("An isolated mount needs a git source");

	return { mode: asked.mode ?? "shared", readOnly: asked.readOnly ?? false };
}

/** Mount paths may neither repeat nor nest: one path in the sandbox belongs to one mount. */
function refuseCollision(mounts: Mount[], path: string): void {
	for (const mount of mounts) {
		if (mount.path === path) throw new Error(`${mount.path} is already a mount`);
		if (isInside(path, mount.path)) throw new Error(`${path} is inside the mount at ${mount.path}`);
		if (isInside(mount.path, path)) throw new Error(`${path} would contain the mount at ${mount.path}`);
	}
}

function isInside(path: string, parent: string): boolean {
	const between = relative(parent, path);

	return between.length > 0 && !between.startsWith("..") && !between.startsWith(sep);
}

/**
 * How a mount materializes: a link to the directory or to the workspace's clone, except for an
 * isolated mount, which is a worktree of that clone and so is the checkout rather than pointing at one.
 */
async function attach(
	context: ToolTarget,
	source: MountSource,
	mode: Mount["mode"],
	link: string,
): Promise<string | undefined> {
	await mkdir(dirname(link), { recursive: true });

	if (source.type === "git") {
		const clone = await ensureBaseClone(context.root, context.workspaceId, source);
		const { defaultBranch } = gitConfigOf(source);

		// Refs only, so a conversation already standing on the shared checkout sees nothing move.
		const fetched = await git(["fetch", "origin"], clone).then(
			() => true,
			() => false,
		);

		if (mode === "isolated") {
			const from = fetched ? `origin/${defaultBranch}` : defaultBranch;
			await addWorktree(clone, link, from);

			return from;
		}

		await symlink(clone, link);

		return undefined;
	}

	if (source.type === "conversations") {
		await symlink(conversationsDirectory(context.root, context.workspaceId), link);

		return undefined;
	}

	const path = directoryOf(source);
	if (!(await isDirectory(path))) throw new Error(`${path} is not a directory`);

	await symlink(path, link);

	return undefined;
}

/** Unmounting a link leaves the data behind it; unmounting a worktree discards it and its branches. */
async function detach(context: ToolTarget, mount: Mount, link: string): Promise<void> {
	if (mount.mode !== "isolated") return unlink(link);

	const clone = baseClonePath(context.root, context.workspaceId, mount.sourceId);
	const entries = await readEntries(conversationFile(context.root, context.workspaceId, context.conversationId));

	await removeWorktree(clone, link);
	await deleteBranches(clone, branchesCreatedOn(entries, mount.path));
}

function directoryOf(source: MountSource): string {
	const path = source.config.path;
	if (typeof path !== "string") throw new Error(`Source ${source.name} has no directory`);

	return path;
}

function nameOf(workspace: Workspace, sourceId: string): string {
	return workspace.sources.find((source) => source.id === sourceId)?.name ?? "unknown";
}

async function isDirectory(path: string): Promise<boolean> {
	return stat(path).then(
		(found) => found.isDirectory(),
		() => false,
	);
}
