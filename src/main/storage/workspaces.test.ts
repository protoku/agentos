import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendEntry } from "./conversationFile";
import { startConversation } from "./conversations";
import { createScriptTool } from "./scriptTools";
import { conversationFile, createWorkspace, loadWorkspaces } from "./workspaceStore";
import { deleteWorkspace } from "./workspaces";
import { invokeTool } from "../tools/invoke";
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
		await createWorkspace(root, "Kept");

		await deleteWorkspace(root, deleted.id);

		expect((await loadWorkspaces(root)).map((workspace) => workspace.name)).toEqual(["Kept"]);
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

	it("waits out the call it cancels, whose entry would build the workspace again", async () => {
		const workspace = await createWorkspace(root, "Acme API");
		const { conversation } = await startConversation(root, workspace.id, "Scratch work");
		await createScriptTool(root, workspace.id, {
			name: "slow",
			description: "Take a while.",
			code: "await new Promise((wait) => setTimeout(wait, 1000)); return {};",
			env: [],
			inputSchema: { type: "object", properties: {}, required: [] },
			outputSchema: { type: "object", properties: {}, required: [] },
		});

		let started = () => {};
		const running = new Promise<void>((resolve) => (started = resolve));
		const call = invokeTool(root, workspace.id, conversation.id, "slow", {}, (entry) => {
			if (entry.type === "toolCall" && entry.status === "running") started();
		});
		await running;

		await deleteWorkspace(root, workspace.id);

		expect(await call).toMatchObject({ status: "canceled" });
		expect(await readdir(join(root, "workspaces"))).toEqual([]);
	}, 15_000);

	it("refuses an id that is not there", async () => {
		await expect(deleteWorkspace(root, "nope")).rejects.toThrow("No workspace nope");
	});
});
