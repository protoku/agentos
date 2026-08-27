import { randomUUID } from "node:crypto";
import { z } from "zod";
import { define, type BuiltinToolImplementation, type ToolContext } from "./define";
import { listAgents } from "../storage/agents";
import { loadWorkspace } from "../storage/workspaceStore";
import { queueTask, runningTask } from "../turns/task";
import { settingIn, taskRounds } from "../../shared/settings";
import type { Agent, Assignment, TaskStart } from "../../shared/types";

const agentName = z.string().describe("The agent, by name");
const ask = z.string().describe("What this agent is asked for in the round").meta({ render: "text" });
const criterion = z.string().describe("What its result will be judged against, decided before the work");

/**
 * The tools that steer the conversation's own run rather than anything in the sandbox: granting
 * them is what makes an agent a director, which is why the three that act on a running task refuse
 * anyone else.
 */
export const taskTools: BuiltinToolImplementation[] = [
	define({
		id: "task_start",
		description: "Start a task in this conversation: a goal, a roster that acts in order, and the director that judges each round.",
		input: z.object({
			goal: z.string().describe("What the task is for, and what being done would mean").meta({ render: "text" }),
			director: agentName.describe("The agent that judges every round and decides what happens next"),
			roster: z
				.array(z.object({ agent: agentName, ask, criterion }))
				.describe("Who acts in the first round, in the order they act"),
			rounds: z.number().int().positive().optional().describe("The round cap, when it differs from the workspace's"),
		}),
		outputSchema: {
			type: "object",
			properties: {
				goal: { type: "string", render: "text" },
				director: { type: "string" },
				rounds: { type: "number" },
				roster: {
					type: "array",
					render: "table",
					items: {
						type: "object",
						properties: { agent: { type: "string" }, ask: { type: "string" }, criterion: { type: "string" } },
						required: ["agent", "ask", "criterion"],
					},
				},
			},
			required: ["goal", "director", "rounds", "roster"],
		},
		async run(input, context) {
			const agents = await listAgents(context.root, context.workspaceId);
			const director = named(agents, input.director);
			if (director.tools["task_done"] === undefined || director.tools["task_done"] === "deny") {
				throw new Error(`@${director.name} cannot close a task, so it cannot direct one`);
			}
			if (input.roster.length === 0) throw new Error("A task needs someone to act in its first round");

			const roster = input.roster.map((wanted) => assign(agents, director, wanted));
			const workspace = await loadWorkspace(context.root, context.workspaceId);
			const start: TaskStart = {
				type: "taskStart",
				id: randomUUID(),
				...(context.agentId !== undefined && { agentId: context.agentId }),
				directorId: director.id,
				goal: input.goal,
				roster,
				rounds: input.rounds ?? settingIn(workspace.env, taskRounds),
				createdAt: new Date().toISOString(),
			};

			// The caller holds the conversation until this call settles, so the task waits for that.
			queueTask(context.conversationId, start);

			return {
				goal: start.goal,
				director: director.name,
				rounds: start.rounds,
				roster: roster.map((assignment, index) => ({
					agent: input.roster[index].agent,
					ask: assignment.ask,
					criterion: assignment.criterion,
				})),
			};
		},
	}),
	define({
		id: "task_add",
		description: "Name an agent to act in the next round of the running task.",
		input: z.object({ agent: agentName, ask, criterion }),
		outputSchema: {
			type: "object",
			properties: { agent: { type: "string" }, ask: { type: "string" }, next: { type: "number" } },
			required: ["agent", "ask", "next"],
		},
		async run(input, context) {
			const task = directing(context);
			const agents = await listAgents(context.root, context.workspaceId);
			const director = named(agents, task.directorId, "id");

			task.next.push(assign(agents, director, input));

			return { agent: input.agent, ask: input.ask, next: task.next.length };
		},
	}),
	define({
		id: "task_done",
		description: "End the running task as done, with the verdict that closes it.",
		input: z.object({
			verdict: z.string().describe("Why the goal is met, against what was asked for").meta({ render: "text" }),
		}),
		outputSchema: {
			type: "object",
			properties: { status: { type: "string" }, verdict: { type: "string", render: "text" } },
			required: ["status", "verdict"],
		},
		run({ verdict }, context) {
			directing(context).ending = { status: "done", verdict };

			return Promise.resolve({ status: "done", verdict });
		},
	}),
	define({
		id: "task_block",
		description: "End the running task with the specific question that stopped it, for the user to answer.",
		input: z.object({
			question: z.string().describe("The one question you cannot answer yourself").meta({ render: "text" }),
		}),
		outputSchema: {
			type: "object",
			properties: { status: { type: "string" }, question: { type: "string", render: "text" } },
			required: ["status", "question"],
		},
		run({ question }, context) {
			directing(context).ending = { status: "blocked", question };

			return Promise.resolve({ status: "blocked", question });
		},
	}),
];

/** Steering a run belongs to the agent that was given it, whoever else happens to hold the tool. */
function directing(context: ToolContext) {
	const task = runningTask(context.conversationId);
	if (task === undefined) throw new Error("No task is running in this conversation");
	if (context.agentId !== task.directorId) throw new Error("Only the director of this task can steer it");

	return task;
}

/** The agent that judges the work never does it, so naming it as work is refused wherever it happens. */
function assign(
	agents: Agent[],
	director: Agent,
	wanted: { agent: string; ask: string; criterion: string },
): Assignment {
	const agent = named(agents, wanted.agent);
	if (agent.id === director.id) throw new Error(`@${director.name} directs this task, so it cannot be given work in it`);

	return { agentId: agent.id, ask: wanted.ask, criterion: wanted.criterion };
}

function named(agents: Agent[], wanted: string, by: "name" | "id" = "name"): Agent {
	const agent = agents.find((candidate) =>
		by === "id" ? candidate.id === wanted : candidate.name.toLowerCase() === wanted.toLowerCase(),
	);
	if (agent === undefined) throw new Error(`No agent ${wanted}`);

	return agent;
}
