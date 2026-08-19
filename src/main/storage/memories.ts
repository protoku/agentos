import { randomUUID } from "node:crypto";
import { loadWorkspace, saveWorkspace } from "./workspaceStore";
import { asTags } from "../../shared/memory";
import type { Memory } from "../../shared/types";

export type MemoryDraft = Pick<Memory, "title" | "body" | "tags" | "agentId">;

/** Long enough for what a workspace knows, short enough to hand an agent every turn. */
const bodyLimit = 2000;

export async function listMemories(root: string, workspaceId: string): Promise<Memory[]> {
	return (await loadWorkspace(root, workspaceId)).memories;
}

export async function createMemory(root: string, workspaceId: string, draft: MemoryDraft): Promise<Memory> {
	const workspace = await loadWorkspace(root, workspaceId);
	const written = new Date().toISOString();
	const memory: Memory = {
		id: randomUUID(),
		...settle(draft, workspace.memories),
		...(draft.agentId !== undefined && { agentId: draft.agentId }),
		createdAt: written,
		updatedAt: written,
	};

	workspace.memories.push(memory);
	await saveWorkspace(root, workspace);

	return memory;
}

/** Edited in place: a memory has no version history, and who wrote it is not who last touched it. */
export async function updateMemory(root: string, workspaceId: string, memory: Memory): Promise<Memory> {
	const workspace = await loadWorkspace(root, workspaceId);
	const existing = workspace.memories.find((candidate) => candidate.id === memory.id);
	if (existing === undefined) throw new Error(`No memory ${memory.id}`);

	const written: Memory = {
		...existing,
		...settle(memory, workspace.memories.filter((candidate) => candidate !== existing)),
		updatedAt: new Date().toISOString(),
	};

	workspace.memories[workspace.memories.indexOf(existing)] = written;
	await saveWorkspace(root, workspace);

	return written;
}

/**
 * The one thing inside a workspace that can be removed. An agent nobody mentions costs a line in a
 * picker, while a memory that is wrong is handed to agents at the start of every turn.
 */
export async function deleteMemory(root: string, workspaceId: string, memoryId: string): Promise<Memory> {
	const workspace = await loadWorkspace(root, workspaceId);
	const memory = workspace.memories.find((candidate) => candidate.id === memoryId);
	if (memory === undefined) throw new Error(`No memory ${memoryId}`);

	workspace.memories = workspace.memories.filter((candidate) => candidate !== memory);
	await saveWorkspace(root, workspace);

	return memory;
}

/** What a memory must be to be written: titles point at one memory, and a body stays readable. */
function settle(draft: Pick<Memory, "title" | "body" | "tags">, others: Memory[]) {
	const title = draft.title.trim();
	const body = draft.body.trim();

	if (title.length === 0) throw new Error("A memory needs a title");
	if (body.length === 0) throw new Error("A memory needs a body");
	if (body.length > bodyLimit) {
		throw new Error(`A memory is at most ${bodyLimit} characters: this one is ${body.length}`);
	}

	const taken = others.find((candidate) => candidate.title.toLowerCase() === title.toLowerCase());
	if (taken !== undefined) throw new Error(`A memory titled ${taken.title} already exists`);

	return { title, body, tags: asTags(draft.tags) };
}
