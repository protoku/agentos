import { mkdir, stat, symlink, unlink } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";
import { z } from "zod";
import { define, sandboxPath, type BuiltinToolImplementation, type ToolContext } from "./define";
import { resolveInSandbox } from "./sandbox";
import { loadWorkspace, saveWorkspace } from "../storage/workspaceStore";
import type { Conversation, Mount, MountSource, Workspace } from "../../shared/types";

const mountPath = sandboxPath.describe("Where in the sandbox the source is attached");

export const mountTools: BuiltinToolImplementation[] = [
	define({
		id: "mount",
		description: "Attach a workspace mount source into the sandbox at a path.",
		input: z.object({
			source: z.string().describe("Name of the workspace mount source"),
			path: mountPath,
			mode: z.enum(["shared", "isolated"]).default("shared"),
			readOnly: z.boolean().default(false),
		}),
		outputSchema: {
			type: "object",
			properties: {
				source: { type: "string" },
				path: { type: "string" },
				mode: { enum: ["shared", "isolated"] },
				readOnly: { type: "boolean" },
			},
			required: ["source", "path", "mode", "readOnly"],
		},
		async run({ source: name, path, mode, readOnly }, context) {
			const { workspace, conversation } = await open(context);
			const source = workspace.sources.find((candidate) => candidate.name === name);
			if (source === undefined) throw new Error(`No source ${name}`);

			// Only a git source has branching to build an isolated checkout from.
			if (mode === "isolated" && source.type !== "git") throw new Error("An isolated mount needs a git source");
			if (source.type !== "directory") throw new Error(`Cannot mount a ${source.type} source yet`);

			refuseCollision(conversation.mounts, path);

			const target = directoryOf(source);
			if (!(await isDirectory(target))) throw new Error(`${target} is not a directory`);

			const link = resolveInSandbox(context.sandbox, path);
			await mkdir(dirname(link), { recursive: true });
			await symlink(target, link);

			const mount: Mount = { sourceId: source.id, path, mode, readOnly, createdAt: new Date().toISOString() };
			conversation.mounts.push(mount);
			await saveWorkspace(context.root, workspace);

			return { source: name, path, mode, readOnly };
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

			await unlink(resolveInSandbox(context.sandbox, path));

			// The mounts list is current state: the record of what happened is this call in the thread.
			conversation.mounts = conversation.mounts.filter((candidate) => candidate !== mount);
			await saveWorkspace(context.root, workspace);

			return { source: nameOf(workspace, mount.sourceId), path };
		},
	}),
];

async function open(context: ToolContext): Promise<{ workspace: Workspace; conversation: Conversation }> {
	const workspace = await loadWorkspace(context.root, context.workspaceId);
	const conversation = workspace.conversations.find((candidate) => candidate.id === context.conversationId);
	if (conversation === undefined) throw new Error(`No conversation ${context.conversationId}`);

	return { workspace, conversation };
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
