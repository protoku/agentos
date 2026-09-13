import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invokeTool } from "./invoke";
import { listWorkflows } from "../storage/workflows";
import { startConversation } from "../storage/conversations";
import { createWorkspace } from "../storage/workspaceStore";
import type { ToolCall } from "../../shared/types";

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

const definition = "steps:\n  - id: read\n    agent: analyst\n    ask: What is this about?\n";

function invoke(toolId: string, input: Record<string, unknown>): Promise<ToolCall> {
	return invokeTool(root, workspaceId, conversationId, toolId, input, () => {});
}

describe("define_workflow", () => {
	it("writes the workflow the workspace then holds", async () => {
		const call = await invoke("define_workflow", { name: "intake", description: "Requests", definition });

		expect(call).toMatchObject({ status: "success", output: { name: "intake" } });
		expect(await listWorkflows(root, workspaceId)).toMatchObject([{ name: "intake", definition }]);
	});

	it("says what is wrong with a definition rather than storing it", async () => {
		const call = await invoke("define_workflow", { name: "intake", description: "", definition: "steps: []" });

		expect(call).toMatchObject({ status: "error" });
		expect(call.error).toContain("at least one step");
		expect(await listWorkflows(root, workspaceId)).toEqual([]);
	});
});

describe("update_workflow", () => {
	it("changes what it is given and leaves the rest, naming it by name", async () => {
		await invoke("define_workflow", { name: "intake", description: "Requests", definition });

		const call = await invoke("update_workflow", { name: "intake", rename: "triage" });

		expect(call).toMatchObject({ status: "success", output: { name: "triage" } });
		expect(await listWorkflows(root, workspaceId)).toMatchObject([
			{ name: "triage", description: "Requests", definition },
		]);
	});

	it("refuses one the workspace does not have", async () => {
		expect(await invoke("update_workflow", { name: "nope" })).toMatchObject({
			status: "error",
			error: "No workflow nope",
		});
	});
});

describe("delete_workflow", () => {
	it("removes it, and what it ran is nobody's to remove", async () => {
		await invoke("define_workflow", { name: "intake", description: "Requests", definition });

		expect(await invoke("delete_workflow", { name: "intake" })).toMatchObject({ status: "success" });
		expect(await listWorkflows(root, workspaceId)).toEqual([]);
	});
});
