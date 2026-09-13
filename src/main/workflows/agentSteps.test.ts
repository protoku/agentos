import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWorkflow } from "./run";
import { readConversation, startConversation } from "../storage/conversations";
import { createWorkflow } from "../storage/workflows";
import { createAgent } from "../storage/agents";
import { createWorkspace } from "../storage/workspaceStore";
import type { Workflow } from "../../shared/types";

/** A turn is a model call, so what a turn does is stood in for: the step around it is the subject. */
const turns = vi.hoisted(() => ({ take: vi.fn() }));

vi.mock("../turns/run", async (original) => ({
	...(await original<typeof import("../turns/run")>()),
	runTurnFor: turns.take,
}));

let root: string;
let workspaceId: string;
let conversationId: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agentos-"));
	workspaceId = (await createWorkspace(root, "Acme API")).id;
	conversationId = (await startConversation(root, workspaceId, "Scratch work")).conversation.id;
	await createAgent(root, workspaceId, {
		name: "analyst",
		model: "claude-opus-5",
		systemPrompt: "",
		tools: {},
		carries: [],
	});
	turns.take.mockReset();
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const reading = `steps:
  - id: read
    agent: analyst
    ask: Read it and say what it needs
    result:
      what:
        type: string
  - id: write
    tool: write_file
    input:
      path: found.md
      content: "{{ read.what }}"
`;

function workflowOf(definition: string): Promise<Workflow> {
	return createWorkflow(root, workspaceId, { name: "reading", description: "", definition });
}

function finished() {
	return { type: "turnEnd", id: "t1", turnId: "t1", status: "finished", createdAt: "" };
}

describe("an agent step", () => {
	it("carries what the agent declared into the steps after it", async () => {
		const { declared, resultTools } = await import("./result");

		// The agent declares through the tool the step lends it, which is what the turn stands in for.
		turns.take.mockImplementation(async () => {
			await resultTools[0].run(
				{ result: { what: "A health check" } },
				{ root, workspaceId, conversationId, sandbox: "", signal: new AbortController().signal },
			);

			return finished();
		});

		await runWorkflow(root, workspaceId, conversationId, await workflowOf(reading), {}, () => {});

		const entries = await readConversation(root, workspaceId, conversationId);
		expect(entries.at(-1)).toMatchObject({ type: "workflowEnd", status: "done" });
		expect(entries.find((entry) => entry.type === "toolCall")).toMatchObject({
			input: { content: "A health check" },
		});
		expect(declared(conversationId)).toBeUndefined();
	});

	it("fails the step where the agent declared nothing", async () => {
		turns.take.mockResolvedValue(finished());

		await runWorkflow(root, workspaceId, conversationId, await workflowOf(reading), {}, () => {});

		expect((await readConversation(root, workspaceId, conversationId)).at(-1)).toMatchObject({
			status: "failed",
			stepId: "read",
			error: "@analyst ended the step without declaring what it was asked for",
		});
	});

	it("fails the step where the agent it names is not in the workspace", async () => {
		const gone = "steps:\n  - id: read\n    agent: nobody\n    ask: anything\n";

		await runWorkflow(root, workspaceId, conversationId, await workflowOf(gone), {}, () => {});

		expect((await readConversation(root, workspaceId, conversationId)).at(-1)).toMatchObject({
			status: "failed",
			error: "No agent nobody",
		});
	});
});
