import { randomUUID } from "node:crypto";
import { loadWorkspace, saveWorkspace } from "./workspaceStore";
import type { MountSource } from "../../shared/types";

export type SourceDraft = Pick<MountSource, "name" | "type" | "config">;

export async function listSources(root: string, workspaceId: string): Promise<MountSource[]> {
	return (await loadWorkspace(root, workspaceId)).sources;
}

export async function createSource(root: string, workspaceId: string, draft: SourceDraft): Promise<MountSource> {
	const workspace = await loadWorkspace(root, workspaceId);
	const source: MountSource = {
		id: randomUUID(),
		name: draft.name,
		createdAt: new Date().toISOString(),
		type: draft.type,
		config: draft.config,
	};

	workspace.sources.push(source);
	await saveWorkspace(root, workspace);

	return source;
}
