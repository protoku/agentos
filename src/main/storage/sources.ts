import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { loadWorkspace, saveWorkspace } from "./workspaceStore";
import { baseClonePath } from "../git/clone";
import type { MountSource } from "../../shared/types";

export type SourceDraft = Pick<MountSource, "name" | "type" | "config" | "description">;

export async function listSources(root: string, workspaceId: string): Promise<MountSource[]> {
	return (await loadWorkspace(root, workspaceId)).sources;
}

export async function createSource(root: string, workspaceId: string, draft: SourceDraft): Promise<MountSource> {
	const workspace = await loadWorkspace(root, workspaceId);
	// A mount asks for its source by name, so a name points at one source or none.
	if (workspace.sources.some((source) => source.name === draft.name)) {
		throw new Error(`A source named ${draft.name} already exists`);
	}

	const source: MountSource = {
		id: randomUUID(),
		name: draft.name,
		createdAt: new Date().toISOString(),
		type: draft.type,
		config: draft.config,
		...described(draft.description),
	};

	workspace.sources.push(source);
	await saveWorkspace(root, workspace);

	return source;
}

/** The description is the one thing a source changes about itself; what it is stays what it was. */
export async function updateSource(
	root: string,
	workspaceId: string,
	sourceId: string,
	description: string,
): Promise<MountSource> {
	const workspace = await loadWorkspace(root, workspaceId);
	const source = workspace.sources.find((candidate) => candidate.id === sourceId);
	if (source === undefined) throw new Error(`No source ${sourceId}`);

	const written = description.trim();
	if (written.length === 0) delete source.description;
	else source.description = written;

	await saveWorkspace(root, workspace);

	return source;
}

/**
 * A source goes only once nothing mounts it, so no conversation loses the ground it is standing on.
 * What goes with it is the workspace's own clone, and with that whatever was never pushed; the
 * remote and a directory source's directory are not the workspace's to remove.
 */
export async function deleteSource(root: string, workspaceId: string, sourceId: string): Promise<MountSource> {
	const workspace = await loadWorkspace(root, workspaceId);
	const source = workspace.sources.find((candidate) => candidate.id === sourceId);
	if (source === undefined) throw new Error(`No source ${sourceId}`);

	const mounting = workspace.conversations.filter((conversation) =>
		conversation.mounts.some((mount) => mount.sourceId === sourceId),
	);
	if (mounting.length > 0) {
		const titles = mounting.map((conversation) => conversation.title).join(", ");
		throw new Error(`${source.name} is mounted in ${titles}: unmount it there first`);
	}

	workspace.sources = workspace.sources.filter((candidate) => candidate !== source);
	await saveWorkspace(root, workspace);
	await rm(baseClonePath(root, workspaceId, source.id), { recursive: true, force: true });

	return source;
}

/** Nothing written is no description at all, rather than a source carrying an empty line. */
function described(description: string | undefined): Pick<MountSource, "description"> {
	const written = description?.trim() ?? "";

	return written.length === 0 ? {} : { description: written };
}
