import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invokeTool } from "./invoke";
import { archiveConversation, listConversations, startConversation } from "../storage/conversations";
import { createWorkspace } from "../storage/workspaceStore";

let root: string;
let workspaceId: string;
let conversationId: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agentos-"));
	workspaceId = (await createWorkspace(root, "Acme API")).id;
	conversationId = (await startConversation(root, workspaceId, "Scratch work")).conversation.id;
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function invoke(input: Record<string, unknown>) {
	return invokeTool(root, workspaceId, conversationId, "rename_conversation", input, () => {});
}

async function titleNow(): Promise<string | undefined> {
	const conversations = await listConversations(root, workspaceId);

	return conversations.find((conversation) => conversation.id === conversationId)?.title;
}

describe("rename_conversation", () => {
	it("retitles the conversation and says what it was called", async () => {
		expect(await invoke({ title: "Invoice import" })).toMatchObject({
			status: "success",
			output: { title: "Invoice import", previous: "Scratch work" },
		});
		expect(await titleNow()).toBe("Invoice import");
	});

	it("refuses a title that is nothing", async () => {
		expect(await invoke({ title: "   " })).toMatchObject({ status: "error", error: "A conversation needs a name" });
		expect(await titleNow()).toBe("Scratch work");
	});

	it("refuses a conversation that is closed", async () => {
		await archiveConversation(root, workspaceId, conversationId);

		expect(await invoke({ title: "Invoice import" })).toMatchObject({
			status: "error",
			error: "This conversation is closed",
		});
	});
});
