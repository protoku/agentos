import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cancelWorkflow, isWorkflowRunning, runWorkflow } from "./run";
import { appendEntry, recoverInterruptedTurns } from "../storage/conversationFile";
import { readConversation, startConversation } from "../storage/conversations";
import { createWorkflow } from "../storage/workflows";
import { conversationFile, createWorkspace, loadWorkspace } from "../storage/workspaceStore";
import type { Entry, Workflow } from "../../shared/types";

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

const notes = `input:
  what:
    type: string

steps:
  - id: write
    tool: write_file
    input:
      path: notes.md
      content: "{{ input.what }}"
  - id: read
    tool: read_file
    input:
      path: "{{ write.path }}"
`;

function workflowOf(definition: string): Promise<Workflow> {
	return createWorkflow(root, workspaceId, { name: "notes", description: "", definition });
}

function run(workflow: Workflow, input: Record<string, unknown> = {}): Promise<void> {
	return runWorkflow(root, workspaceId, conversationId, workflow, input, () => {});
}

function sandboxOf(): Promise<string> {
	return loadWorkspace(root, workspaceId).then((workspace) => workspace.conversations[0].sandbox ?? "");
}

function kinds(entries: Entry[]): string[] {
	return entries.map((entry) => entry.type);
}

describe("runWorkflow", () => {
	it("takes its steps in order, each reading what the ones before produced", async () => {
		await run(await workflowOf(notes), { what: "Ship it" });

		const entries = await readConversation(root, workspaceId, conversationId);
		expect(kinds(entries)).toEqual([
			"userMessage",
			"workflowStart",
			"workflowStep",
			"toolCall",
			"workflowStep",
			"toolCall",
			"workflowEnd",
		]);
		expect(entries.at(-1)).toMatchObject({ type: "workflowEnd", status: "done" });
		expect(await readFile(join(await sandboxOf(), "notes.md"), "utf8")).toBe("Ship it");
	});

	it("says what a step is about to do before it does it", async () => {
		await run(await workflowOf(notes), { what: "Ship it" });

		const entries = await readConversation(root, workspaceId, conversationId);
		expect(entries[2]).toMatchObject({
			type: "workflowStep",
			stepId: "write",
			tool: "write_file",
			input: { path: "notes.md", content: "Ship it" },
		});
	});

	it("stops at the step that failed, and says which one it was", async () => {
		const missing =
			"steps:\n  - id: read\n    tool: read_file\n    input:\n      path: gone.md\n  - id: never\n    tool: list_files\n";

		await run(await workflowOf(missing));

		const entries = await readConversation(root, workspaceId, conversationId);
		expect(kinds(entries)).toEqual(["userMessage", "workflowStart", "workflowStep", "toolCall", "workflowEnd"]);
		expect(entries.at(-1)).toMatchObject({ type: "workflowEnd", status: "failed", stepId: "read" });
	});

	it("fails the run where a step reads something that is not there", async () => {
		const wrong =
			'steps:\n  - id: write\n    tool: write_file\n    input:\n      path: "{{ input.gone }}"\n      content: x\n';

		await run(await workflowOf(wrong));

		expect((await readConversation(root, workspaceId, conversationId)).at(-1)).toMatchObject({
			type: "workflowEnd",
			status: "failed",
			error: "input says nothing about gone",
		});
	});

	it("stops where it was asked to, and no later step begins", async () => {
		const three = `steps:
  - id: one
    tool: write_file
    input: { path: one.md, content: x }
  - id: two
    tool: write_file
    input: { path: two.md, content: x }
`;
		const workflow = await workflowOf(three);

		const running = runWorkflow(root, workspaceId, conversationId, workflow, {}, (entry) => {
			if (entry.type === "workflowStep" && entry.stepId === "one") cancelWorkflow(conversationId);
		});
		await running;

		const entries = await readConversation(root, workspaceId, conversationId);
		expect(entries.at(-1)).toMatchObject({ type: "workflowEnd", status: "canceled", stepId: "one" });
		expect(entries.filter((entry) => entry.type === "workflowStep")).toHaveLength(1);
	});

	it("closes a run the restart interrupted, since no step of it is resumed", async () => {
		const file = conversationFile(root, workspaceId, conversationId);
		await appendEntry(file, {
			type: "workflowStart",
			id: "r1",
			workflowId: "w1",
			name: "notes",
			input: {},
			createdAt: "2026-09-13T10:00:00.000Z",
		});

		const ends = await recoverInterruptedTurns(file);

		expect(ends).toMatchObject([{ type: "workflowEnd", runId: "r1", status: "canceled" }]);
		expect(await recoverInterruptedTurns(file)).toEqual([]);
	});

	it("skips a step whose condition does not hold, and records that it did", async () => {
		const maybe = `steps:
  - id: write
    tool: write_file
    input: { path: notes.md, content: "" }
  - id: shout
    when: "{{ write.bytes }}"
    tool: write_file
    input: { path: shout.md, content: loud }
  - id: quiet
    tool: write_file
    input: { path: quiet.md, content: soft }
`;

		await run(await workflowOf(maybe));

		const entries = await readConversation(root, workspaceId, conversationId);
		expect(entries.at(-1)).toMatchObject({ type: "workflowEnd", status: "done" });
		expect(entries.filter((entry) => entry.type === "workflowStep")).toMatchObject([
			{ stepId: "write" },
			{ stepId: "shout", skipped: true },
			{ stepId: "quiet" },
		]);
	});

	it("fails a step that reads what a skipped step would have produced", async () => {
		const after = `steps:
  - id: maybe
    when: "{{ input.never }}"
    tool: write_file
    input: { path: a.md, content: a }
  - id: reads
    tool: write_file
    input: { path: b.md, content: "{{ maybe.path }}" }
`;

		await run(await workflowOf(after), { never: false });

		expect((await readConversation(root, workspaceId, conversationId)).at(-1)).toMatchObject({
			status: "failed",
			error: "maybe was skipped, so it produced nothing to read",
		});
	});

	it("holds the conversation while it runs and lets go when it ends", async () => {
		const workflow = await workflowOf(notes);
		const running = run(workflow, { what: "Ship it" });

		expect(isWorkflowRunning(conversationId)).toBe(true);
		await running;
		expect(isWorkflowRunning(conversationId)).toBe(false);
	});
});
