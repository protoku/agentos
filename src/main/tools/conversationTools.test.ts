import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invokeTool, whenCallSettles } from "./invoke";
import {
	archiveConversation,
	listConversations,
	readConversation,
	startConversation,
} from "../storage/conversations";
import { createSource } from "../storage/sources";
import { createWorkflow } from "../storage/workflows";
import { createWorkspace, loadWorkspace } from "../storage/workspaceStore";
import { whenWorkflowSettles } from "../workflows/run";

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

describe("create_conversation", () => {
	function create(input: Record<string, unknown>) {
		return invokeTool(root, workspaceId, conversationId, "create_conversation", input, () => {});
	}

	async function opened(): Promise<string[]> {
		const conversations = await listConversations(root, workspaceId);

		return conversations.filter((conversation) => conversation.id !== conversationId).map((each) => each.title);
	}

	it("opens a conversation started by the prompt, titled by it", async () => {
		const call = await create({ prompt: "Review MR !42 when you can" });

		expect(call).toMatchObject({ status: "success", output: { title: "Review MR !42 when you can", started: "message" } });
		const entries = await readConversation(root, workspaceId, String(call.output?.conversationId));
		expect(entries).toMatchObject([{ type: "userMessage", content: "Review MR !42 when you can" }]);
	});

	it("takes a title instead of the prompt's when given one", async () => {
		const call = await create({ prompt: "Look at this", title: "MR !42" });

		expect(call.output).toMatchObject({ title: "MR !42" });
		expect(await opened()).toEqual(["MR !42"]);
	});

	it("starts a tool the prompt invokes, as the user would", async () => {
		const call = await create({ prompt: '/write_file path=notes.md content="Ship it"' });
		const created = String(call.output?.conversationId);
		await whenCallSettles(created);

		expect(call.output).toMatchObject({ started: "tool" });
		const entries = await readConversation(root, workspaceId, created);
		expect(entries).toMatchObject([{ type: "toolCall", toolId: "write_file", status: "success" }]);
		expect(entries[0]).not.toHaveProperty("agentId");
	});

	it("starts a workflow the prompt names", async () => {
		const definition = "steps:\n  - id: write\n    tool: write_file\n    input:\n      path: notes.md\n      content: hi\n";
		await createWorkflow(root, workspaceId, { name: "jot", description: "", definition });

		const call = await create({ prompt: "/jot" });
		const created = String(call.output?.conversationId);
		await whenWorkflowSettles(created);

		expect(call.output).toMatchObject({ started: "workflow" });
		const entries = await readConversation(root, workspaceId, created);
		expect(entries.at(-1)).toMatchObject({ type: "workflowEnd", status: "done" });
	});

	it("attaches its mounts before the prompt", async () => {
		const notes = join(root, "notes");
		await mkdir(notes);
		await createSource(root, workspaceId, { name: "notes", type: "directory", config: { path: notes } });

		const call = await create({ prompt: "Read the notes", mounts: [{ source: "notes", path: "notes" }] });

		const entries = await readConversation(root, workspaceId, String(call.output?.conversationId));
		expect(entries).toMatchObject([
			{ type: "toolCall", toolId: "mount", status: "success" },
			{ type: "userMessage", content: "Read the notes" },
		]);
		expect(await opened()).toEqual(["Read the notes"]);
	});

	it("stops at a mount that fails, sending nothing and naming the conversation it opened", async () => {
		const call = await create({ prompt: "Read the notes", mounts: [{ source: "nowhere", path: "notes" }] });

		expect(call.status).toBe("error");
		expect(call.error).toMatch(/^Mounting nowhere failed in the new conversation "Read the notes" \(.+\), so its prompt was not sent: No source nowhere$/);
		const created = (await loadWorkspace(root, workspaceId)).conversations.find((each) => each.id !== conversationId);
		const entries = await readConversation(root, workspaceId, String(created?.id));
		expect(entries).toMatchObject([{ type: "toolCall", toolId: "mount", status: "error" }]);
	});

	it.each([
		["   ", "A new conversation needs a prompt to start with"],
		["/summarize @dev", "A new conversation holds nothing to summarize yet"],
		["/no_such_thing", "No tool no_such_thing"],
	])("refuses %j before anything exists", async (prompt, error) => {
		expect(await create({ prompt })).toMatchObject({ status: "error", error });
		expect(await opened()).toEqual([]);
	});
});
