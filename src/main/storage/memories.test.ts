import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemory, deleteMemory, listMemories, updateMemory } from "./memories";
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

const draft = {
	title: "Deploy process",
	body: "Blue-green through scripts/deploy. main is never pushed to directly.",
	tags: ["deploy", "ops"],
};

describe("createMemory", () => {
	it("records what was written, with when and by whom", async () => {
		const memory = await createMemory(root, workspaceId, { ...draft, agentId: "agent-1" });

		expect(memory).toMatchObject({ ...draft, agentId: "agent-1", id: expect.any(String) });
		expect(memory.updatedAt).toBe(memory.createdAt);
		expect(await listMemories(root, workspaceId)).toEqual([memory]);
	});

	it("carries no agent when the user wrote it", async () => {
		expect(await createMemory(root, workspaceId, draft)).not.toHaveProperty("agentId");
	});

	it("trims what it is given and files the tags as names", async () => {
		const memory = await createMemory(root, workspaceId, {
			title: "  Deploy process  ",
			body: "  Blue-green.  ",
			tags: [" Ops ", "ops"],
		});

		expect(memory).toMatchObject({ title: "Deploy process", body: "Blue-green.", tags: ["ops"] });
	});

	it("refuses a memory with nothing to say", async () => {
		await expect(createMemory(root, workspaceId, { ...draft, title: " " })).rejects.toThrow("A memory needs a title");
		await expect(createMemory(root, workspaceId, { ...draft, body: " " })).rejects.toThrow("A memory needs a body");
	});

	it("refuses a body longer than a paragraph or two", async () => {
		const body = "x".repeat(2001);

		await expect(createMemory(root, workspaceId, { ...draft, body })).rejects.toThrow(
			"A memory is at most 2000 characters: this one is 2001",
		);
	});

	it("refuses a title the workspace already knows, naming what is there", async () => {
		await createMemory(root, workspaceId, draft);

		await expect(createMemory(root, workspaceId, { ...draft, title: "deploy PROCESS" })).rejects.toThrow(
			"A memory titled Deploy process already exists",
		);
	});

	it("refuses a tag that is prose", async () => {
		await expect(createMemory(root, workspaceId, { ...draft, tags: ["deploy process"] })).rejects.toThrow(
			"deploy process is not a tag: use letters, digits, hyphens and underscores",
		);
	});
});

describe("updateMemory", () => {
	it("edits in place, keeping the id, when it was written and who wrote it", async () => {
		const memory = await createMemory(root, workspaceId, { ...draft, agentId: "agent-1" });

		const edited = await updateMemory(root, workspaceId, { ...memory, body: "Blue-green, and never on Friday." });

		expect(edited).toMatchObject({ id: memory.id, agentId: "agent-1", createdAt: memory.createdAt });
		expect(edited.body).toBe("Blue-green, and never on Friday.");
		expect(await listMemories(root, workspaceId)).toEqual([edited]);
	});

	it("keeps its own title, and refuses another memory's", async () => {
		const memory = await createMemory(root, workspaceId, draft);
		await createMemory(root, workspaceId, { title: "Staging tokens", body: "In Env.", tags: [] });

		expect(await updateMemory(root, workspaceId, { ...memory, body: "Changed." })).toMatchObject({
			title: "Deploy process",
		});
		await expect(updateMemory(root, workspaceId, { ...memory, title: "staging tokens" })).rejects.toThrow(
			"A memory titled Staging tokens already exists",
		);
	});

	it("refuses a memory the workspace does not have", async () => {
		const memory = await createMemory(root, workspaceId, draft);

		await expect(updateMemory(root, workspaceId, { ...memory, id: "gone" })).rejects.toThrow("No memory gone");
	});
});

describe("deleteMemory", () => {
	it("forgets one and leaves the rest, saying what went", async () => {
		const memory = await createMemory(root, workspaceId, draft);
		const kept = await createMemory(root, workspaceId, { title: "Staging tokens", body: "In Env.", tags: [] });

		expect(await deleteMemory(root, workspaceId, memory.id)).toEqual(memory);
		expect(await listMemories(root, workspaceId)).toEqual([kept]);
	});

	it("refuses a memory the workspace does not have", async () => {
		await expect(deleteMemory(root, workspaceId, "gone")).rejects.toThrow("No memory gone");
	});
});
