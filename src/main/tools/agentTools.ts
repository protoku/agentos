import { z } from "zod";
import { builtinTools } from "./builtin";
import { define, type BuiltinToolImplementation, type ToolContext } from "./define";
import { createAgent, listAgents, updateAgent } from "../storage/agents";
import { listScriptTools } from "../storage/scriptTools";
import { asTags } from "../../shared/memory";
import { defaultModel, models } from "../../shared/models";
import type { Agent } from "../../shared/types";

const permission = z.enum(["allow", "ask", "deny"]);
const granted = z
	.record(z.string(), permission)
	.describe("What the agent may use, by tool name: allow runs it, ask needs approval, deny hides it");
const carries = z.array(z.string()).default([]).describe("Memory tags this agent carries into every turn");
const model = z.string().describe(`The model it runs on, one of ${models.map((known) => known.id).join(", ")}`);
const agentName = z.string().describe("The agent, by name");

/**
 * The tools for building agents: the work of building tools one level up, and the same weight, since
 * an agent that writes agents hands out permissions of its own choosing.
 */
export const agentTools: BuiltinToolImplementation[] = [
	define({
		id: "list_agents",
		description: "List the agents of this workspace.",
		input: z.object({}),
		outputSchema: {
			type: "object",
			properties: {
				agents: {
					type: "array",
					render: "table",
					items: {
						type: "object",
						properties: {
							name: { type: "string" },
							model: { type: "string" },
							carries: { type: "string" },
							tools: { type: "number" },
						},
						required: ["name", "model", "carries", "tools"],
					},
				},
			},
			required: ["agents"],
		},
		async run(_input, context) {
			const agents = await listAgents(context.root, context.workspaceId);

			return {
				agents: agents.map((agent) => ({
					name: agent.name,
					model: agent.model,
					carries: agent.carries.join(", "),
					tools: Object.keys(agent.tools).length,
				})),
			};
		},
	}),
	define({
		id: "read_agent",
		description: "Read one agent of this workspace whole, its system prompt and its permissions included.",
		input: z.object({ name: agentName }),
		outputSchema: {
			type: "object",
			properties: {
				name: { type: "string" },
				model: { type: "string" },
				carries: { type: "string" },
				systemPrompt: { type: "string", render: "text" },
				tools: {
					type: "array",
					render: "table",
					items: {
						type: "object",
						properties: { tool: { type: "string" }, permission: { type: "string" } },
						required: ["tool", "permission"],
					},
				},
			},
			required: ["name", "model", "carries", "systemPrompt", "tools"],
		},
		async run({ name }, context) {
			const agent = await agentNamed(context, name);

			return {
				name: agent.name,
				model: agent.model,
				carries: agent.carries.join(", "),
				systemPrompt: agent.systemPrompt,
				tools: await grantedNames(context, agent.tools),
			};
		},
	}),
	define({
		id: "create_agent",
		description: "Add an agent to this workspace, saying how it behaves and what it may use.",
		input: z.object({
			name: z.string().describe("One name, unique in the workspace, as it will be @mentioned"),
			model: model.default(defaultModel),
			systemPrompt: z
				.string()
				.describe("What this agent is for and how it should behave")
				.meta({ render: "text" }),
			tools: granted.default({}),
			carries,
		}),
		outputSchema: written(),
		async run(draft, context) {
			const agent = await createAgent(context.root, context.workspaceId, {
				name: draft.name,
				model: knownModel(draft.model),
				systemPrompt: draft.systemPrompt,
				tools: await permissionsByName(context, draft.tools),
				carries: asTags(draft.carries),
			});

			return { id: agent.id, name: agent.name, tools: Object.keys(agent.tools).length };
		},
	}),
	define({
		id: "update_agent",
		description: "Change an agent of this workspace, naming it as it is named now.",
		input: z.object({
			name: agentName,
			rename: z.string().optional().describe("A new name, if it should have one"),
			model: model.optional(),
			systemPrompt: z.string().optional().meta({ render: "text" }),
			tools: granted.optional().describe("The whole permission list, replacing what it had"),
			carries: z.array(z.string()).optional().describe("The whole list, replacing what it had"),
		}),
		outputSchema: written(),
		async run({ name, rename, ...changes }, context) {
			const agent = await agentNamed(context, name);
			const written = await updateAgent(context.root, context.workspaceId, {
				...agent,
				...(rename !== undefined && { name: rename }),
				...(changes.model !== undefined && { model: knownModel(changes.model) }),
				...(changes.systemPrompt !== undefined && { systemPrompt: changes.systemPrompt }),
				...(changes.tools !== undefined && { tools: await permissionsByName(context, changes.tools) }),
				...(changes.carries !== undefined && { carries: asTags(changes.carries) }),
			});

			return { id: written.id, name: written.name, tools: Object.keys(written.tools).length };
		},
	}),
];

/** What writing an agent reports: who it is now, and how much it was just handed. */
function written(): Record<string, unknown> {
	return {
		type: "object",
		properties: { id: { type: "string" }, name: { type: "string" }, tools: { type: "number" } },
		required: ["id", "name", "tools"],
	};
}

async function agentNamed(context: ToolContext, name: string): Promise<Agent> {
	const agents = await listAgents(context.root, context.workspaceId);
	const agent = agents.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
	if (agent === undefined) throw new Error(`No agent ${name}`);

	return agent;
}

function knownModel(named: string): string {
	if (!models.some((known) => known.id === named)) throw new Error(`No model ${named}`);

	return named;
}

/**
 * Permissions arrive by tool name, since a script tool's id is what the workspace generated and
 * nothing a caller could know. Denied is the absence of a permission, exactly as in the pane.
 */
async function permissionsByName(
	context: ToolContext,
	wanted: Record<string, "allow" | "ask" | "deny">,
): Promise<Agent["tools"]> {
	const tools = await knownTools(context);
	const permissions: Agent["tools"] = {};

	for (const [name, permission] of Object.entries(wanted)) {
		const tool = tools.find((candidate) => candidate.name === name);
		if (tool === undefined) throw new Error(`No tool ${name}`);
		if (permission !== "deny") permissions[tool.id] = permission;
	}

	return permissions;
}

/** The way back: an id the workspace no longer knows still reads as itself rather than vanishing. */
async function grantedNames(
	context: ToolContext,
	permissions: Agent["tools"],
): Promise<{ tool: string; permission: string }[]> {
	const tools = await knownTools(context);

	return Object.entries(permissions).map(([toolId, permission]) => ({
		tool: tools.find((candidate) => candidate.id === toolId)?.name ?? toolId,
		permission,
	}));
}

async function knownTools(context: ToolContext): Promise<{ id: string; name: string }[]> {
	return [...builtinTools, ...(await listScriptTools(context.root, context.workspaceId))];
}
