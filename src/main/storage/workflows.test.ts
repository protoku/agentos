import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflow, deleteWorkflow, listWorkflows, updateWorkflow } from "./workflows";
import { createScriptTool } from "./scriptTools";
import { createWorkspace } from "./workspaceStore";

let root: string;
let workspaceId: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agentos-"));
	workspaceId = (await createWorkspace(root, "Acme API")).id;
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const definition = `steps:
  - id: read
    agent: analyst
    ask: What is this about?
  - id: file
    tool: jira_create
    input:
      summary: "{{ read.what }}"
`;

const intake = { name: "intake", description: "Chat request to ticket", definition };

describe("createWorkflow", () => {
	it("keeps the definition as it was written", async () => {
		const workflow = await createWorkflow(root, workspaceId, intake);

		expect(workflow).toMatchObject(intake);
		expect(workflow.createdAt).toBeDefined();
		expect(await listWorkflows(root, workspaceId)).toEqual([workflow]);
	});

	it("refuses a definition that does not read as a workflow", async () => {
		await expect(createWorkflow(root, workspaceId, { ...intake, definition: "steps: []" })).rejects.toThrow(
			"at least one step",
		);
		const both = "steps:\n  - id: a\n    tool: x\n    agent: y\n";
		await expect(createWorkflow(root, workspaceId, { ...intake, definition: both })).rejects.toThrow(
			"names either a tool or an agent",
		);
		expect(await listWorkflows(root, workspaceId)).toEqual([]);
	});

	it("refuses a step that reads something nothing before it produced", async () => {
		const ahead =
			'steps:\n  - id: a\n    tool: x\n    input:\n      of: "{{ later.thing }}"\n  - id: later\n    tool: y\n';

		await expect(createWorkflow(root, workspaceId, { ...intake, definition: ahead })).rejects.toThrow(
			"a reads later, which nothing before it produced",
		);
	});

	it("refuses a name a tool already answers to, in either direction", async () => {
		await createWorkflow(root, workspaceId, intake);

		await expect(
			createScriptTool(root, workspaceId, {
				name: "intake",
				description: "",
				code: "",
				env: [],
				inputSchema: {},
				outputSchema: {},
			}),
		).rejects.toThrow("intake is a workflow of this workspace");

		await expect(createWorkflow(root, workspaceId, { ...intake, name: "write_file" })).rejects.toThrow(
			"write_file is a built-in tool",
		);
		await expect(createWorkflow(root, workspaceId, intake)).rejects.toThrow(
			"A workflow named intake already exists",
		);
	});
});

describe("updateWorkflow", () => {
	it("rewrites it in place, keeping the id a past run points at", async () => {
		const workflow = await createWorkflow(root, workspaceId, intake);

		const written = await updateWorkflow(root, workspaceId, { ...workflow, description: "Now with a gate" });

		expect(written).toMatchObject({
			id: workflow.id,
			createdAt: workflow.createdAt,
			description: "Now with a gate",
		});
		expect(await listWorkflows(root, workspaceId)).toEqual([written]);
	});

	it("refuses a definition that stopped reading as a workflow", async () => {
		const workflow = await createWorkflow(root, workspaceId, intake);

		await expect(updateWorkflow(root, workspaceId, { ...workflow, definition: "steps: what" })).rejects.toThrow(
			"at least one step",
		);
	});
});

describe("deleteWorkflow", () => {
	it("forgets it, which nothing else in a workspace allows", async () => {
		const workflow = await createWorkflow(root, workspaceId, intake);

		expect(await deleteWorkflow(root, workspaceId, workflow.id)).toEqual(workflow);
		expect(await listWorkflows(root, workspaceId)).toEqual([]);
	});

	it("refuses one the workspace does not have", async () => {
		await expect(deleteWorkflow(root, workspaceId, "nope")).rejects.toThrow("No workflow nope");
	});
});
