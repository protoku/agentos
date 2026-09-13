import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isWorkflowRunning, runWorkflow } from "./run";
import { readConversation, startConversation } from "../storage/conversations";
import { createWorkflow } from "../storage/workflows";
import { createWorkspace, loadWorkspace } from "../storage/workspaceStore";
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
		const missing = "steps:\n  - id: read\n    tool: read_file\n    input:\n      path: gone.md\n  - id: never\n    tool: list_files\n";

		await run(await workflowOf(missing));

		const entries = await readConversation(root, workspaceId, conversationId);
		expect(kinds(entries)).toEqual(["userMessage", "workflowStart", "workflowStep", "toolCall", "workflowEnd"]);
		expect(entries.at(-1)).toMatchObject({ type: "workflowEnd", status: "failed", stepId: "read" });
	});

	it("fails the run where a step reads something that is not there", async () => {
		const wrong = 'steps:\n  - id: write\n    tool: write_file\n    input:\n      path: "{{ input.gone }}"\n      content: x\n';

		await run(await workflowOf(wrong));

		expect((await readConversation(root, workspaceId, conversationId)).at(-1)).toMatchObject({
			type: "workflowEnd",
			status: "failed",
			error: "input says nothing about gone",
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
