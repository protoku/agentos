import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	archiveConversation,
	listConversations,
	readConversation,
	sendMessage,
	startConversation,
	startConversationWithTool,
} from "./conversations";
import { createWorkspace, loadWorkspace } from "./workspaceStore";
import { createAgent } from "./agents";

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

describe("mentions", () => {
	it("resolves @names to agent ids when the message is sent", async () => {
		const ops = await createAgent(root, workspaceId, { name: "ops", model: "m", systemPrompt: "", tools: {}, carries: [] });

		const { message } = await startConversation(root, workspaceId, "@ops deploy please");

		expect(message.mentions).toEqual([ops.id]);
	});

	it("leaves a message without resolvable mentions unmarked", async () => {
		const { message } = await startConversation(root, workspaceId, "@nobody deploy please");

		expect(message.mentions).toBeUndefined();
	});
});

describe("sendMessage", () => {
	it("appends to a thread that already exists", async () => {
		const { conversation, message } = await startConversation(root, workspaceId, "First");

		const second = await sendMessage(root, workspaceId, conversation.id, "Second");

		expect(await readConversation(root, workspaceId, conversation.id)).toEqual([message, second]);
	});
});

describe("archiveConversation", () => {
	it("stamps archivedAt on the record and keeps the thread readable", async () => {
		const { conversation, message } = await startConversation(root, workspaceId, "Deploy the API");

		const archived = await archiveConversation(root, workspaceId, conversation.id);

		expect(archived.archivedAt).toEqual(expect.any(String));
		expect((await loadWorkspace(root, workspaceId)).conversations[0].archivedAt).toBe(archived.archivedAt);
		expect(await readConversation(root, workspaceId, conversation.id)).toEqual([message]);
	});

	it("refuses a conversation the workspace does not have", async () => {
		await expect(archiveConversation(root, workspaceId, "nope")).rejects.toThrow("No conversation nope");
	});
});

describe("listConversations", () => {
	it("keeps archived conversations in the list", async () => {
		const { conversation } = await startConversation(root, workspaceId, "Deploy the API");
		await archiveConversation(root, workspaceId, conversation.id);

		const summaries = await listConversations(root, workspaceId);

		expect(summaries).toHaveLength(1);
		expect(summaries[0].archivedAt).toEqual(expect.any(String));
	});

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

describe("startConversationWithTool", () => {
	it("creates the conversation, titled by the command, with the call as its first entry", async () => {
		const { conversation, call } = await startConversationWithTool(
			root,
			workspaceId,
			'/write_file path=a.txt content="Ship it"',
			{ toolId: "write_file", input: { path: "a.txt", content: "Ship it" } },
			() => () => {},
		);

		expect(conversation.title).toBe('/write_file path=a.txt content="Ship it"');
		expect(call).toMatchObject({ status: "success", toolId: "write_file" });
		expect(await readConversation(root, workspaceId, conversation.id)).toEqual([call]);
	});

	it("leaves a conversation behind even when the call fails, since the call happened", async () => {
		const { conversation, call } = await startConversationWithTool(
			root,
			workspaceId,
			"/mount",
			{ toolId: "mount", input: {} },
			() => () => {},
		);

		expect(call.status).toBe("error");
		expect(await readConversation(root, workspaceId, conversation.id)).toEqual([call]);
	});
});
