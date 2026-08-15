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
