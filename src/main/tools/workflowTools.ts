import { z } from "zod";
import { define, type BuiltinToolImplementation } from "./define";
import { createWorkflow, deleteWorkflow, listWorkflows, updateWorkflow } from "../storage/workflows";
import { parseDefinition } from "../workflows/definition";

const definition = z
	.string()
	.describe("The workflow in YAML: input, then steps, each with an id and either a tool or an agent")
	.meta({ render: "text" });

const written = {
	type: "object",
	properties: { id: { type: "string" }, name: { type: "string" } },
	required: ["id", "name"],
};

/** The tools for building workflows: what the user runs is written here, and read before it runs. */
export const workflowTools: BuiltinToolImplementation[] = [
	define({
		id: "list_workflows",
		description: "List the workflows of this workspace.",
		input: z.object({}),
		outputSchema: {
			type: "object",
			properties: {
				workflows: {
					type: "array",
					render: "table",
					items: {
						type: "object",
						properties: {
							name: { type: "string" },
							description: { type: "string" },
							steps: { type: "number" },
						},
						required: ["name", "description", "steps"],
					},
				},
			},
			required: ["workflows"],
		},
		async run(_input, context) {
			const workflows = await listWorkflows(context.root, context.workspaceId);

			return {
				workflows: workflows.map((workflow) => ({
					name: workflow.name,
					description: workflow.description,
					steps: parseDefinition(workflow.definition).steps.length,
				})),
			};
		},
	}),
	define({
		id: "read_workflow",
		description: "Read one workflow of this workspace whole, its definition as it was written.",
		input: z.object({ name: z.string().describe("The workflow to read") }),
		outputSchema: {
			type: "object",
			properties: {
				name: { type: "string" },
				description: { type: "string" },
				definition: { type: "string", render: "text" },
			},
			required: ["name", "description", "definition"],
		},
		async run({ name }, context) {
			const workflow = await named(context.root, context.workspaceId, name);

			return { name: workflow.name, description: workflow.description, definition: workflow.definition };
		},
	}),
	define({
		id: "define_workflow",
		description:
			"Add a workflow to this workspace. The user starts it from the composer by its name; you cannot run it.",
		input: z.object({
			name: z.string().describe("One word, unique among the workspace's tools and workflows"),
			description: z.string().describe("What it is for, and when to run it"),
			definition,
		}),
		outputSchema: written,
		async run(draft, context) {
			const workflow = await createWorkflow(context.root, context.workspaceId, draft);

			return { id: workflow.id, name: workflow.name };
		},
	}),
	define({
		id: "update_workflow",
		description: "Change a workflow of this workspace, naming it as it is named now.",
		input: z.object({
			name: z.string().describe("The workflow to change"),
			description: z.string().optional(),
			definition: definition.optional(),
			rename: z.string().optional().describe("A new name, if it should have one"),
		}),
		outputSchema: written,
		async run({ name, rename, ...changes }, context) {
			const workflow = await named(context.root, context.workspaceId, name);
			const given = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));

			const updated = await updateWorkflow(context.root, context.workspaceId, {
				...workflow,
				...given,
				...(rename !== undefined && { name: rename }),
			});

			return { id: updated.id, name: updated.name };
		},
	}),
	define({
		id: "delete_workflow",
		description: "Remove a workflow from this workspace. What it already ran stays in the threads that ran it.",
		input: z.object({ name: z.string().describe("The workflow to remove") }),
		outputSchema: written,
		async run({ name }, context) {
			const workflow = await named(context.root, context.workspaceId, name);
			await deleteWorkflow(context.root, context.workspaceId, workflow.id);

			return { id: workflow.id, name: workflow.name };
		},
	}),
];

/** Named as the user names it, since an id is not what an agent reads anywhere else either. */
async function named(root: string, workspaceId: string, name: string) {
	const workflow = (await listWorkflows(root, workspaceId)).find((candidate) => candidate.name === name);
	if (workflow === undefined) throw new Error(`No workflow ${name}`);

	return workflow;
}
