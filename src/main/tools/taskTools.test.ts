import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { builtinTool } from "./builtin";
import { invokeTool } from "./invoke";
import { createAgent } from "../storage/agents";
import { startConversation } from "../storage/conversations";
import { createWorkspace, loadWorkspace, saveWorkspace } from "../storage/workspaceStore";
import { runTask, takeQueuedTask, type TaskHooks } from "../turns/task";
import { defaultModel } from "../../shared/models";
import type { TaskStart, ToolCall, TurnEnd } from "../../shared/types";

let root: string;
let workspaceId: string;
let conversationId: string;
let directorId: string;
let writerId: string;

function invoke(toolId: string, input: Record<string, unknown> = {}): Promise<ToolCall> {
	return invokeTool(root, workspaceId, conversationId, toolId, input, () => {});
}

/** What an agent's own call sees, which is the same context minus the user's authority. */
function asAgent(toolId: string, input: Record<string, unknown>, agentId: string) {
	return builtinTool(toolId).run(input, {
		root,
		workspaceId,
		conversationId,
		sandbox: join(root, "sandbox"),
		signal: new AbortController().signal,
		agentId,
	});
}

function agent(name: string, tools: Record<string, "allow" | "ask" | "deny">) {
	return createAgent(root, workspaceId, {
		name,
		model: defaultModel,
		systemPrompt: "",
		tools,
		carries: [],
	});
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agentos-"));
	workspaceId = (await createWorkspace(root, "Acme API")).id;
	conversationId = (await startConversation(root, workspaceId, "The launch note")).conversation.id;
	directorId = (await agent("editor", { task_add: "allow", task_done: "allow", task_block: "allow" })).id;
	writerId = (await agent("writer", { write_file: "allow" })).id;
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const roster = [{ agent: "writer", ask: "draft the note", criterion: "it reads in one minute" }];

describe("task_start", () => {
	it("queues a task for the moment the conversation is free", async () => {
		const call = await invoke("task_start", { goal: "Write the launch note", director: "editor", roster });

		expect(call).toMatchObject({ status: "success", output: { director: "editor", rounds: 12 } });

		expect(takeQueuedTask(conversationId)).toMatchObject({
			type: "taskStart",
			directorId,
			goal: "Write the launch note",
			rounds: 12,
			roster: [{ agentId: writerId, ask: "draft the note", criterion: "it reads in one minute" }],
		});
	});

	it("takes the cap the task names, and otherwise the workspace's", async () => {
		const workspace = await loadWorkspace(root, workspaceId);
		workspace.env = { WORKSPACE_TASK_ROUNDS: "4" };
		await saveWorkspace(root, workspace);

		await invoke("task_start", { goal: "Write it", director: "editor", roster });
		expect(takeQueuedTask(conversationId)?.rounds).toBe(4);

		await invoke("task_start", { goal: "Write it", director: "editor", roster, rounds: 2 });
		expect(takeQueuedTask(conversationId)?.rounds).toBe(2);
	});

	it("refuses a director that cannot close what it directs", async () => {
		await agent("bystander", { read_file: "allow" });

		expect(await invoke("task_start", { goal: "Write it", director: "bystander", roster })).toMatchObject({
			error: "@bystander cannot close a task, so it cannot direct one",
		});
	});

	it("refuses to give the director work in its own task", async () => {
		const asked = [{ agent: "editor", ask: "write it", criterion: "it reads" }];

		expect(await invoke("task_start", { goal: "Write it", director: "editor", roster: asked })).toMatchObject({
			error: "@editor directs this task, so it cannot be given work in it",
		});
	});

	it("refuses a second task where one is already waiting", async () => {
		await invoke("task_start", { goal: "Write it", director: "editor", roster });

		expect(await invoke("task_start", { goal: "Write it again", director: "editor", roster })).toMatchObject({
			error: "A task is already running in this conversation",
		});
	});
});

describe("the tools that steer a running task", () => {
	function started(): TaskStart {
		return {
			type: "taskStart",
			id: "task-1",
			directorId,
			goal: "Write the launch note",
			roster: [{ agentId: writerId, ask: "draft it", criterion: "it reads" }],
			rounds: 3,
			createdAt: "2026-08-15T10:00:00.000Z",
		};
	}

	/** The director's turn is whatever it called, so a test is that call and nothing else. */
	function directed(steer: (agentId: string, round: number) => Promise<unknown>) {
		let round = 0;

		const hooks: TaskHooks = {
			takeTurn: async (agentId) => {
				if (agentId === directorId) await steer(agentId, round).catch(() => {});

				return end();
			},
			record: (entry) => {
				if (entry.type === "taskRound") round = entry.number;

				return Promise.resolve();
			},
			canceled: () => false,
		};

		return hooks;
	}

	function end(): TurnEnd {
		return {
			type: "turnEnd",
			id: "end-1",
			turnId: "turn-1",
			status: "finished",
			createdAt: "2026-08-15T10:00:00.000Z",
		};
	}

	it("closes the task on the director's verdict", async () => {
		const ended = await runTask(
			conversationId,
			started(),
			directed(() => asAgent("task_done", { verdict: "It reads" }, directorId)),
		);

		expect(ended).toMatchObject({ status: "done", verdict: "It reads" });
	});

	it("ends it blocked on the question the director could not answer", async () => {
		const ended = await runTask(
			conversationId,
			started(),
			directed(() => asAgent("task_block", { question: "Which release?" }, directorId)),
		);

		expect(ended).toMatchObject({ status: "blocked", question: "Which release?" });
	});

	it("names who acts next, and stops when the director closes it", async () => {
		const ended = await runTask(
			conversationId,
			started(),
			directed((_agentId, round) =>
				round === 1
					? asAgent("task_add", { agent: "writer", ask: "revise it", criterion: "it reads" }, directorId)
					: asAgent("task_done", { verdict: "It reads now" }, directorId),
			),
		);

		expect(ended).toMatchObject({ status: "done", verdict: "It reads now" });
	});

	it("refuses anyone but the director, however they hold the tool", async () => {
		let refusal: unknown;

		await runTask(
			conversationId,
			started(),
			directed(async () => {
				refusal = await asAgent("task_done", { verdict: "Good enough" }, writerId).catch(
					(failure: Error) => failure.message,
				);
			}),
		);

		expect(refusal).toBe("Only the director of this task can steer it");
	});

	it("refuses to give the director work in the round it judges", async () => {
		let refusal: unknown;

		await runTask(
			conversationId,
			started(),
			directed(async () => {
				refusal = await asAgent(
					"task_add",
					{ agent: "editor", ask: "write it", criterion: "it reads" },
					directorId,
				).catch((failure: Error) => failure.message);
			}),
		);

		expect(refusal).toBe("@editor directs this task, so it cannot be given work in it");
	});

	it("refuses where no task is running at all", async () => {
		await expect(asAgent("task_done", { verdict: "Done" }, directorId)).rejects.toThrow(
			"No task is running in this conversation",
		);
	});
});
