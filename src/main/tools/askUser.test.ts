import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invokeTool } from "./invoke";
import { cancelRuling, rule } from "../turns/decisions";
import { readConversation, startConversation } from "../storage/conversations";
import { createWorkspace } from "../storage/workspaceStore";
import type { Entry, ToolCall } from "../../shared/types";

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

const questions = {
	questions: [
		{
			id: "urgency",
			question: "How urgent is this?",
			header: "Urgency",
			options: [{ label: "This week" }, { label: "Whenever" }],
		},
	],
};

/** The call parks, so the test rules on it the moment the thread shows it pending. */
function ask(answer: (call: ToolCall) => void): Promise<ToolCall> {
	return invokeTool(root, workspaceId, conversationId, "ask_user", questions, (entry: Entry) => {
		if (entry.type === "toolCall" && entry.status === "pending") answer(entry);
	});
}

describe("ask_user", () => {
	it("waits in the thread and ends with what was answered", async () => {
		const call = await ask((pending) => rule(pending.id, { type: "answered", answers: { urgency: "This week" } }));

		expect(call).toMatchObject({ status: "success", output: { urgency: "This week" } });
		expect(call.decidedAt).toBeUndefined();
		expect(await readConversation(root, workspaceId, conversationId)).toHaveLength(2);
	});

	it("is canceled rather than answered when the user stops it", async () => {
		const call = await ask((pending) => cancelRuling(pending.id));

		expect(call).toMatchObject({ status: "canceled" });
		expect(call.output).toBeUndefined();
	});

	it("refuses a call that asks nothing, since a question is what it is for", async () => {
		const call = await invokeTool(root, workspaceId, conversationId, "ask_user", { questions: [] }, () => {});

		expect(call).toMatchObject({ status: "error" });
		expect(call.error).toContain("questions");
	});
});
