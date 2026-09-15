import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendEntry } from "./conversationFile";
import { startConversation } from "./conversations";
import { readUsage } from "./usage";
import { conversationFile, createWorkspace } from "./workspaceStore";
import type { Entry, Spend } from "../../shared/types";

let root: string;
let workspaceId: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agentos-"));
	workspaceId = (await createWorkspace(root, "Acme API")).id;
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const spent: Spend = { sent: 24_100, cached: 1000, received: 100, usd: 0.235 };

async function conversation(title: string): Promise<string> {
	return (await startConversation(root, workspaceId, title)).conversation.id;
}

async function write(conversationId: string, ...entries: Entry[]): Promise<void> {
	for (const entry of entries) await appendEntry(conversationFile(root, workspaceId, conversationId), entry);
}

function took(turnId: string, agentId: string, when: string): Entry {
	return { type: "turnStart", id: turnId, agentId, createdAt: when };
}

function cost(turnId: string, when: string, given?: Partial<{ spent: Spend; model: string }>): Entry {
	return {
		type: "turnEnd",
		id: `${turnId}-end`,
		turnId,
		status: "finished",
		createdAt: when,
		...(given?.spent !== undefined && { spent: given.spent }),
		...(given?.model !== undefined && { model: given.model }),
	};
}

describe("readUsage", () => {
	it("reports every turn that cost something, across the workspace's conversations", async () => {
		const first = await conversation("Invoice import");
		const second = await conversation("Reading the notes");

		await write(
			first,
			took("t1", "agent-dev", "2026-09-10T12:00:00.000Z"),
			cost("t1", "2026-09-10T12:00:01.000Z", { spent, model: "claude-opus-5" }),
		);
		await write(
			second,
			took("t2", "agent-review", "2026-09-11T12:00:00.000Z"),
			cost("t2", "2026-09-11T12:00:01.000Z", { spent, model: "claude-haiku-4-5" }),
		);

		const usage = await readUsage(root, workspaceId);

		expect(usage).toHaveLength(2);
		expect(usage).toContainEqual({
			conversationId: first,
			title: "Invoice import",
			createdAt: "2026-09-10T12:00:01.000Z",
			spent,
			agentId: "agent-dev",
			model: "claude-opus-5",
		});
		expect(usage.map((turn) => turn.title)).toContain("Reading the notes");
	});

	it("joins a turn back to the agent that took it, through the turn's id", async () => {
		const id = await conversation("Scratch work");
		await write(
			id,
			took("t1", "agent-dev", "2026-09-10T12:00:00.000Z"),
			cost("t1", "2026-09-10T12:00:01.000Z", { spent }),
			took("t2", "agent-review", "2026-09-10T12:01:00.000Z"),
			cost("t2", "2026-09-10T12:01:01.000Z", { spent }),
		);

		const usage = await readUsage(root, workspaceId);

		expect(usage.map((turn) => turn.agentId)).toEqual(["agent-dev", "agent-review"]);
	});

	it("leaves out a turn that recorded nothing, rather than counting it as free", async () => {
		const id = await conversation("Scratch work");
		await write(
			id,
			took("t1", "agent-dev", "2026-09-10T12:00:00.000Z"),
			cost("t1", "2026-09-10T12:00:01.000Z"),
		);

		expect(await readUsage(root, workspaceId)).toEqual([]);
	});

	it("keeps a turn recorded before the model was kept, with no model on it", async () => {
		const id = await conversation("Scratch work");
		await write(
			id,
			took("t1", "agent-dev", "2026-09-10T12:00:00.000Z"),
			cost("t1", "2026-09-10T12:00:01.000Z", { spent }),
		);

		const usage = await readUsage(root, workspaceId);

		expect(usage).toHaveLength(1);
		expect(usage[0].model).toBeUndefined();
	});

	it("says nothing for a workspace where nothing has run", async () => {
		expect(await readUsage(root, workspaceId)).toEqual([]);
	});
});
