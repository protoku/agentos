import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSource, deleteSource, listSources, updateSource } from "./sources";
import { baseClonePath } from "../git/clone";
import { startConversation } from "./conversations";
import { createWorkspace, loadWorkspace, saveWorkspace } from "./workspaceStore";

let root: string;
let workspaceId: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agentos-"));
	workspaceId = (await createWorkspace(root, "Acme API")).id;
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const notes = { name: "notes", type: "directory", config: { path: "/srv/notes" } } as const;

describe("createSource", () => {
	it("records the source with its per-type config", async () => {
		const source = await createSource(root, workspaceId, notes);

		expect(source).toMatchObject(notes);
		expect(source.createdAt).toBeDefined();
		expect(await listSources(root, workspaceId)).toEqual([source]);
	});

	it("refuses a name the workspace already uses, since a mount resolves it to one source", async () => {
		await createSource(root, workspaceId, notes);

		await expect(createSource(root, workspaceId, { ...notes, config: { path: "/elsewhere" } })).rejects.toThrow(
			"A source named notes already exists",
		);
		expect(await listSources(root, workspaceId)).toHaveLength(1);
	});

	it("keeps the description it was given, and carries none where nothing was written", async () => {
		const described = await createSource(root, workspaceId, { ...notes, description: "  Runbooks in ops/  " });
		const docs = { name: "docs", type: "directory", config: { path: "/srv/docs" } } as const;
		const bare = await createSource(root, workspaceId, docs);

		expect(described.description).toBe("Runbooks in ops/");
		expect(bare).not.toHaveProperty("description");
	});

	it("keeps sources in the order they were added", async () => {
		await createSource(root, workspaceId, notes);
		await createSource(root, workspaceId, { name: "docs", type: "directory", config: { path: "/srv/docs" } });

		expect((await listSources(root, workspaceId)).map((source) => source.name)).toEqual(["notes", "docs"]);
	});
});

describe("updateSource", () => {
	it("rewrites the description and leaves what the source is alone", async () => {
		const source = await createSource(root, workspaceId, { ...notes, description: "Notes" });

		const written = await updateSource(root, workspaceId, source.id, "Manifests in clusters/prod");

		expect(written).toMatchObject({ ...notes, description: "Manifests in clusters/prod" });
		expect(await listSources(root, workspaceId)).toEqual([written]);
	});

	it("writing nothing leaves the source without a description at all", async () => {
		const source = await createSource(root, workspaceId, { ...notes, description: "Notes" });

		expect(await updateSource(root, workspaceId, source.id, "   ")).not.toHaveProperty("description");
	});

	it("refuses a source the workspace does not have", async () => {
		await expect(updateSource(root, workspaceId, "nope", "Anything")).rejects.toThrow("No source nope");
	});
});

describe("listSources", () => {
	it("returns nothing for a workspace without sources", async () => {
		expect(await listSources(root, workspaceId)).toEqual([]);
	});
});

describe("deleteSource", () => {
	it("removes the source from the workspace", async () => {
		const source = await createSource(root, workspaceId, notes);

		expect(await deleteSource(root, workspaceId, source.id)).toMatchObject({ name: "notes" });
		expect(await listSources(root, workspaceId)).toEqual([]);
	});

	it("refuses one a conversation is standing on, naming the conversation", async () => {
		const source = await createSource(root, workspaceId, notes);
		const { conversation } = await startConversation(root, workspaceId, "Reading the notes");
		await mount(conversation.id, source.id);

		await expect(deleteSource(root, workspaceId, source.id)).rejects.toThrow(
			"notes is mounted in Reading the notes: unmount it there first",
		);
		expect(await listSources(root, workspaceId)).toHaveLength(1);
	});

	it("takes the workspace's own clone with it", async () => {
		const source = await createSource(root, workspaceId, {
			name: "api",
			type: "git",
			config: { remote: "git@example.com:acme/api.git", defaultBranch: "main" },
		});
		const clone = baseClonePath(root, workspaceId, source.id);
		await mkdir(clone, { recursive: true });

		await deleteSource(root, workspaceId, source.id);

		await expect(stat(clone)).rejects.toThrow();
	});

	it("refuses one the workspace does not have", async () => {
		await expect(deleteSource(root, workspaceId, "nope")).rejects.toThrow("No source nope");
	});
});

/** A mount as the mount tool would leave it, which is what stands in the way of deleting a source. */
async function mount(conversationId: string, sourceId: string): Promise<void> {
	const workspace = await loadWorkspace(root, workspaceId);
	const conversation = workspace.conversations.find((candidate) => candidate.id === conversationId);

	conversation?.mounts.push({
		sourceId,
		path: "notes",
		mode: "shared",
		readOnly: false,
		createdAt: new Date().toISOString(),
	});
	await saveWorkspace(root, workspace);
}
