import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createScriptTool, listScriptTools, updateScriptTool } from "./scriptTools";
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

const draft = {
	name: "count_lines",
	description: "Count the lines of a file.",
	code: "return { lines: 1 };",
	env: [],
	inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
	outputSchema: { type: "object", properties: { lines: { type: "number" } }, required: ["lines"] },
};

describe("createScriptTool", () => {
	it("records the tool with an id of its own", async () => {
		const tool = await createScriptTool(root, workspaceId, draft);

		expect(tool).toMatchObject({ ...draft, type: "script" });
		expect(tool.id).toEqual(expect.any(String));
		expect(await listScriptTools(root, workspaceId)).toEqual([tool]);
	});

	it("refuses a name that is not one word, is a built-in, or is already taken", async () => {
		await expect(createScriptTool(root, workspaceId, { ...draft, name: "count lines" })).rejects.toThrow(
			"is not a tool name",
		);
		await expect(createScriptTool(root, workspaceId, { ...draft, name: "read_file" })).rejects.toThrow(
			"read_file is a built-in tool",
		);

		await createScriptTool(root, workspaceId, draft);
		await expect(createScriptTool(root, workspaceId, draft)).rejects.toThrow("A tool named count_lines already exists");
	});
});

describe("updateScriptTool", () => {
	it("edits in place, keeping the id and createdAt", async () => {
		const tool = await createScriptTool(root, workspaceId, draft);

		const edited = await updateScriptTool(root, workspaceId, { ...tool, description: "Counts lines." });

		expect(edited).toMatchObject({ id: tool.id, createdAt: tool.createdAt, description: "Counts lines." });
		expect(await listScriptTools(root, workspaceId)).toEqual([edited]);
	});

	it("lets a tool keep its own name, but not take another's", async () => {
		const tool = await createScriptTool(root, workspaceId, draft);
		await createScriptTool(root, workspaceId, { ...draft, name: "other" });

		await expect(updateScriptTool(root, workspaceId, tool)).resolves.toMatchObject({ name: "count_lines" });
		await expect(updateScriptTool(root, workspaceId, { ...tool, name: "other" })).rejects.toThrow("already exists");
	});
});
