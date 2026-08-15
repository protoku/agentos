import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listConversations, readConversation, sendMessage, startConversation } from "./conversations";
import { createWorkspace, loadWorkspace } from "./workspaceStore";

let root: string;
let workspaceId: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agentos-"));
	workspaceId = (await createWorkspace(root, "Acme API")).id;
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("startConversation", () => {
	it("records the conversation and its first message", async () => {
		const { conversation, message } = await startConversation(root, workspaceId, "Deploy the API");

		expect((await loadWorkspace(root, workspaceId)).conversations).toEqual([conversation]);
		expect(await readConversation(root, workspaceId, conversation.id)).toEqual([message]);
		expect(message).toMatchObject({ type: "userMessage", content: "Deploy the API" });
	});

	it("takes the title from that message, on one line", async () => {
		const { conversation } = await startConversation(root, workspaceId, "  Deploy\n  the API  ");

		expect(conversation.title).toBe("Deploy the API");
	});

	it("shortens a long message into a title, on a word boundary", async () => {
		const content = "Deploy the API and then check that every worker picked up the new configuration";

		const { conversation } = await startConversation(root, workspaceId, content);

		expect(conversation.title).toBe("Deploy the API and then check that every worker picked up…");
	});
});

describe("sendMessage", () => {
	it("appends to a thread that already exists", async () => {
		const { conversation, message } = await startConversation(root, workspaceId, "First");

		const second = await sendMessage(root, workspaceId, conversation.id, "Second");

		expect(await readConversation(root, workspaceId, conversation.id)).toEqual([message, second]);
	});
});

describe("listConversations", () => {
	it("returns nothing for a workspace nobody has written in", async () => {
		expect(await listConversations(root, workspaceId)).toEqual([]);
	});

	it("puts the most recent activity first", async () => {
		vi.useFakeTimers();
		vi.setSystemTime("2026-08-15T10:00:00.000Z");
		const older = await startConversation(root, workspaceId, "Older");
		vi.setSystemTime("2026-08-15T11:00:00.000Z");
		await startConversation(root, workspaceId, "Newer");
		vi.setSystemTime("2026-08-15T12:00:00.000Z");
		await sendMessage(root, workspaceId, older.conversation.id, "Back to the older one");
		vi.useRealTimers();

		const summaries = await listConversations(root, workspaceId);

		expect(summaries.map((summary) => summary.title)).toEqual(["Older", "Newer"]);
		expect(summaries[0].lastActivityAt).toBe("2026-08-15T12:00:00.000Z");
	});
});
