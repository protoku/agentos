import { z } from "zod";
import { define, type BuiltinToolImplementation, type ToolContext } from "./define";
import { createMemory, deleteMemory, listMemories, updateMemory } from "../storage/memories";
import { loadWorkspace } from "../storage/workspaceStore";
import { matchMemories } from "../../shared/memory";

/** As many as are worth reading at once, since every one of them stays in the thread afterwards. */
const searchLimit = 10;

const memoryId = z.string().describe("The id a search returned");
const tags = z.array(z.string()).default([]).describe("Tags to file it under, lower case names");

export const memoryTools: BuiltinToolImplementation[] = [
	define({
		id: "search_memory",
		description: "Search what this workspace knows. Search before assuming, and before writing something down.",
		input: z.object({
			query: z.string().default("").describe("Words to look for in titles, bodies and tags"),
			tags: z.array(z.string()).default([]).describe("Only memories filed under every one of these"),
		}),
		outputSchema: {
			type: "object",
			properties: {
				found: { type: "number" },
				truncated: { type: "boolean" },
				matches: {
					type: "array",
					render: "table",
					items: {
						type: "object",
						properties: {
							title: { type: "string" },
							tags: { type: "string" },
							body: { type: "string" },
							updatedAt: { type: "string" },
							id: { type: "string" },
						},
						required: ["title", "tags", "body", "updatedAt", "id"],
					},
				},
			},
			required: ["found", "truncated", "matches"],
		},
		async run({ query, tags: filed }, context) {
			const found = matchMemories(await listMemories(context.root, context.workspaceId), { query, tags: filed });

			return {
				found: found.length,
				truncated: found.length > searchLimit,
				matches: found.slice(0, searchLimit).map((memory) => ({
					title: memory.title,
					tags: memory.tags.join(", "),
					body: memory.body,
					updatedAt: memory.updatedAt,
					id: memory.id,
				})),
			};
		},
	}),
	define({
		id: "create_memory",
		description:
			"Write down something this workspace should keep. Search first: correct what is wrong " +
			"rather than writing a second memory beside it.",
		input: z.object({
			title: z.string().describe("What it is about, in a few words, unique in the workspace"),
			body: z.string().describe("What is worth knowing, in full").meta({ render: "markdown" }),
			tags,
		}),
		outputSchema: written(),
		async run({ title, body, tags: filed }, context) {
			const memory = await createMemory(context.root, context.workspaceId, {
				title,
				body,
				tags: filed,
				agentId: context.agentId,
			});

			return {
				id: memory.id,
				title: memory.title,
				tags: memory.tags.join(", "),
				carriedBy: await carriers(context, memory.tags),
			};
		},
	}),
	define({
		id: "update_memory",
		description: "Change a memory of this workspace, naming it by the id a search returned.",
		input: z.object({
			id: memoryId,
			title: z.string().optional(),
			body: z.string().optional().meta({ render: "markdown" }),
			tags: z.array(z.string()).optional().describe("The whole list, replacing what it had"),
		}),
		outputSchema: written(),
		async run({ id, ...changes }, context) {
			const memories = await listMemories(context.root, context.workspaceId);
			const memory = memories.find((candidate) => candidate.id === id);
			if (memory === undefined) throw new Error(`No memory ${id}`);

			const written = await updateMemory(context.root, context.workspaceId, {
				...memory,
				...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)),
			});

			return {
				id: written.id,
				title: written.title,
				tags: written.tags.join(", "),
				carriedBy: await carriers(context, written.tags),
			};
		},
	}),
	define({
		id: "delete_memory",
		description: "Forget a memory of this workspace, naming it by the id a search returned.",
		input: z.object({ id: memoryId }),
		outputSchema: {
			type: "object",
			properties: { id: { type: "string" }, title: { type: "string" }, tags: { type: "string" } },
			required: ["id", "title", "tags"],
		},
		async run({ id }, context) {
			const forgotten = await deleteMemory(context.root, context.workspaceId, id);

			return { id: forgotten.id, title: forgotten.title, tags: forgotten.tags.join(", ") };
		},
	}),
];

/** What writing a memory reports, whose point is carriedBy: whose every turn it just joined. */
function written(): Record<string, unknown> {
	return {
		type: "object",
		properties: {
			id: { type: "string" },
			title: { type: "string" },
			tags: { type: "string" },
			carriedBy: { type: "string" },
		},
		required: ["id", "title", "tags", "carriedBy"],
	};
}

async function carriers(context: ToolContext, tags: string[]): Promise<string> {
	const { agents } = await loadWorkspace(context.root, context.workspaceId);
	const carrying = agents.filter((agent) => agent.carries.some((tag) => tags.includes(tag)));

	return carrying.length === 0 ? "nobody" : carrying.map((agent) => `@${agent.name}`).join(", ");
}
