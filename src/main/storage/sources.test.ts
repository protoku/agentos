import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSource, listSources } from "./sources";
import { createWorkspace } from "./workspaceStore";

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

	it("keeps sources in the order they were added", async () => {
		await createSource(root, workspaceId, notes);
		await createSource(root, workspaceId, { name: "docs", type: "directory", config: { path: "/srv/docs" } });

		expect((await listSources(root, workspaceId)).map((source) => source.name)).toEqual(["notes", "docs"]);
	});
});

describe("listSources", () => {
	it("returns nothing for a workspace without sources", async () => {
		expect(await listSources(root, workspaceId)).toEqual([]);
	});
});
