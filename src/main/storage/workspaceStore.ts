import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { recoverInterruptedTurns } from "./conversationFile";
import type { TurnEnd, Workspace } from "../../shared/types";

function workspacesDirectory(root: string): string {
	return join(root, "workspaces");
}

function workspaceDirectory(root: string, workspaceId: string): string {
	return join(workspacesDirectory(root), workspaceId);
}

export function conversationsDirectory(root: string, workspaceId: string): string {
	return join(workspaceDirectory(root, workspaceId), "conversations");
}

export function conversationFile(root: string, workspaceId: string, conversationId: string): string {
	return join(conversationsDirectory(root, workspaceId), `${conversationId}.jsonl`);
}

export async function createWorkspace(root: string, name: string): Promise<Workspace> {
	const workspace: Workspace = {
		id: randomUUID(),
		name,
		createdAt: new Date().toISOString(),
		agents: [],
		tools: [],
		env: {},
		sources: [],
		conversations: [],
	};
	await saveWorkspace(root, workspace);
	return workspace;
}

/**
 * The one deletion in AgentOS: threads, sandboxes, clones and worktrees all live under the
 * workspace directory and go with it. Symlinked directory mounts inside sandboxes are removed
 * as links, since rm never follows them, so the directories they point at stay untouched.
 */
export async function deleteWorkspace(root: string, workspaceId: string): Promise<void> {
	// Loaded first so an id that is not there is refused instead of removing nothing quietly.
	await loadWorkspace(root, workspaceId);
	await rm(workspaceDirectory(root, workspaceId), { recursive: true, force: true });
}

/** Written beside the target and renamed onto it, so a crash never leaves a half written record. */
export async function saveWorkspace(root: string, workspace: Workspace): Promise<void> {
	const directory = workspaceDirectory(root, workspace.id);
	await mkdir(directory, { recursive: true });

	const target = join(directory, "workspace.json");
	const temporary = join(directory, `workspace.json.${randomUUID()}.tmp`);
	await writeFile(temporary, `${JSON.stringify(workspace, null, "\t")}\n`, "utf8");
	await rename(temporary, target);
}

export async function loadWorkspace(root: string, workspaceId: string): Promise<Workspace> {
	const text = await readIfPresent(join(workspaceDirectory(root, workspaceId), "workspace.json"));
	if (text === undefined) throw new Error(`No workspace ${workspaceId}`);

	return JSON.parse(text) as Workspace;
}

export async function loadWorkspaces(root: string): Promise<Workspace[]> {
	const workspaces: Workspace[] = [];

	for (const entry of await directories(workspacesDirectory(root))) {
		const text = await readIfPresent(join(workspacesDirectory(root), entry, "workspace.json"));
		if (text !== undefined) workspaces.push(JSON.parse(text) as Workspace);
	}

	return workspaces.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/** The startup scan: every thread file of every workspace, so no crash leaves a turn open. */
export async function recoverAllInterruptedTurns(root: string): Promise<TurnEnd[]> {
	const ends: TurnEnd[] = [];

	for (const workspace of await loadWorkspaces(root)) {
		const directory = conversationsDirectory(root, workspace.id);
		for (const file of await threadFiles(directory)) {
			ends.push(...(await recoverInterruptedTurns(join(directory, file))));
		}
	}

	return ends;
}

async function directories(path: string): Promise<string[]> {
	try {
		const entries = await readdir(path, { withFileTypes: true });
		return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

async function threadFiles(path: string): Promise<string[]> {
	try {
		return (await readdir(path)).filter((file) => file.endsWith(".jsonl"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

async function readIfPresent(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}
