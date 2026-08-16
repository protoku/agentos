import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { git } from "./git";
import type { MountSource } from "../../shared/types";

export interface GitConfig {
	remote: string;
	defaultBranch: string;
}

export function gitConfigOf(source: MountSource): GitConfig {
	const { remote, defaultBranch } = source.config;
	if (typeof remote !== "string" || typeof defaultBranch !== "string") {
		throw new Error(`Source ${source.name} has no remote and default branch`);
	}

	return { remote, defaultBranch };
}

export function baseClonePath(root: string, workspaceId: string, sourceId: string): string {
	return join(root, "workspaces", workspaceId, "clones", sourceId);
}

/** One clone per source, kept by the workspace: both mount modes are derived from it. */
export async function ensureBaseClone(root: string, workspaceId: string, source: MountSource): Promise<string> {
	const clone = baseClonePath(root, workspaceId, source.id);
	if (await exists(clone)) return clone;

	const { remote, defaultBranch } = gitConfigOf(source);
	await mkdir(join(root, "workspaces", workspaceId, "clones"), { recursive: true });
	await git(["clone", "--branch", defaultBranch, remote, clone]);

	return clone;
}

async function exists(path: string): Promise<boolean> {
	return stat(path).then(
		() => true,
		() => false,
	);
}
