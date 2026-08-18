import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendEntry, readEntries } from "./conversationFile";
import {
	conversationFile,
	createWorkspace,
	deleteWorkspace,
	loadWorkspaces,
	recoverAllInterruptedTurns,
	saveWorkspace,
} from "./workspaceStore";
import type { TurnStart } from "../../shared/types";

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agentos-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function turnStart(id: string): TurnStart {
	return { type: "turnStart", id, agentId: "agent-1", createdAt: "2026-08-15T10:00:00.000Z" };
}

describe("createWorkspace", () => {
	it("keeps the name and an empty env in a record that loads back", async () => {
		const created = await createWorkspace(root, "Acme API");

		expect(await loadWorkspaces(root)).toEqual([created]);
		expect(created).toMatchObject({ name: "Acme API", env: {}, agents: [], conversations: [] });
	});

	it("names the folder by id, not by name", async () => {
		const created = await createWorkspace(root, "Acme API");

		expect(await readdir(join(root, "workspaces"))).toEqual([created.id]);
	});
});

describe("deleteWorkspace", () => {
	it("takes the workspace and everything it owns", async () => {
		const workspace = await createWorkspace(root, "Acme API");
		await appendEntry(conversationFile(root, workspace.id, "c1"), turnStart("t1"));
		await mkdir(join(root, "workspaces", workspace.id, "clones", "source-1"), { recursive: true });

		await deleteWorkspace(root, workspace.id);

		expect(await loadWorkspaces(root)).toEqual([]);
		expect(await readdir(join(root, "workspaces"))).toEqual([]);
	});

	it("leaves the other workspaces standing", async () => {
		const deleted = await createWorkspace(root, "Gone");
		const kept = await createWorkspace(root, "Kept");

		await deleteWorkspace(root, deleted.id);

		expect((await loadWorkspaces(root)).map((workspace) => workspace.name)).toEqual(["Kept"]);
		expect(kept.name).toBe("Kept");
	});

	it("removes a mounted directory as a link, not what it points at", async () => {
		const workspace = await createWorkspace(root, "Acme API");
		const outside = join(root, "notes");
		await mkdir(outside, { recursive: true });
		await writeFile(join(outside, "todo.md"), "Ship it", "utf8");
		const sandbox = join(root, "workspaces", workspace.id, "sandboxes", "c1");
		await mkdir(sandbox, { recursive: true });
		await symlink(outside, join(sandbox, "notes"));

		await deleteWorkspace(root, workspace.id);

		expect(await readdir(outside)).toEqual(["todo.md"]);
	});

	it("refuses an id that is not there", async () => {
		await expect(deleteWorkspace(root, "nope")).rejects.toThrow("No workspace nope");
	});
});

describe("loadWorkspaces", () => {
	it("returns nothing when no workspace was ever created", async () => {
		expect(await loadWorkspaces(root)).toEqual([]);
	});

	it("orders by createdAt", async () => {
		await createWorkspace(root, "First");
		const second = await createWorkspace(root, "Second");
		second.createdAt = "2099-01-01T00:00:00.000Z";
		await saveWorkspace(root, second);

		expect((await loadWorkspaces(root)).map((workspace) => workspace.name)).toEqual(["First", "Second"]);
	});
});

describe("saveWorkspace", () => {
	it("replaces the record and leaves no temporary file behind", async () => {
		const workspace = await createWorkspace(root, "Acme API");
		workspace.name = "Acme API staging";
		workspace.env = { API_TOKEN: "secret" };
		await saveWorkspace(root, workspace);

		expect(await loadWorkspaces(root)).toEqual([workspace]);
		expect(await readdir(join(root, "workspaces", workspace.id))).toEqual(["workspace.json"]);
	});
});

describe("recoverAllInterruptedTurns", () => {
	it("closes open turns across workspaces and leaves settled threads alone", async () => {
		const interrupted = await createWorkspace(root, "Interrupted");
		const settled = await createWorkspace(root, "Settled");
		const openThread = conversationFile(root, interrupted.id, "c1");
		const settledThread = conversationFile(root, settled.id, "c2");
		await appendEntry(openThread, turnStart("t1"));
		await appendEntry(settledThread, turnStart("t2"));
		await appendEntry(settledThread, {
			type: "turnEnd",
			id: "end-t2",
			turnId: "t2",
			status: "finished",
			createdAt: "2026-08-15T10:00:01.000Z",
		});

		const ends = await recoverAllInterruptedTurns(root);

		expect(ends).toHaveLength(1);
		expect(ends[0]).toMatchObject({ turnId: "t1", status: "failed" });
		expect(await readEntries(openThread)).toHaveLength(2);
		expect(await readEntries(settledThread)).toHaveLength(2);
	});

	it("has nothing to close in a workspace without conversations", async () => {
		await createWorkspace(root, "Empty");

		expect(await recoverAllInterruptedTurns(root)).toEqual([]);
	});
});
