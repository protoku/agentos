import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invokeTool } from "./invoke";
import { ensureSandbox } from "./sandbox";
import { createSource } from "../storage/sources";
import { startConversation } from "../storage/conversations";
import { createWorkspace, loadWorkspace } from "../storage/workspaceStore";
import type { ToolCall } from "../../shared/types";

let root: string;
let workspaceId: string;
let conversationId: string;
let notes: string;
let sandbox: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agentos-"));
	notes = await mkdtemp(join(tmpdir(), "agentos-notes-"));
	await writeFile(join(notes, "todo.md"), "Ship it", "utf8");

	workspaceId = (await createWorkspace(root, "Acme API")).id;
	conversationId = (await startConversation(root, workspaceId, "Scratch work")).conversation.id;
	sandbox = await ensureSandbox(root, workspaceId, conversationId);
	await createSource(root, workspaceId, { name: "notes", type: "directory", config: { path: notes } });
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
	await rm(notes, { recursive: true, force: true });
});

function invoke(toolId: string, input: Record<string, unknown>): Promise<ToolCall> {
	return invokeTool(root, workspaceId, conversationId, toolId, input, () => {});
}

function mountsOf() {
	return loadWorkspace(root, workspaceId).then((workspace) => workspace.conversations[0].mounts);
}

describe("mount", () => {
	it("links the directory into the sandbox and records the mount", async () => {
		const call = await invoke("mount", { source: "notes", path: "notes" });

		expect(call).toMatchObject({ status: "success", output: { source: "notes", path: "notes", mode: "shared" } });
		expect(await readFile(join(sandbox, "notes", "todo.md"), "utf8")).toBe("Ship it");
		expect(await mountsOf()).toMatchObject([{ path: "notes", mode: "shared", readOnly: false }]);
	});

	it("reaches the real directory, so what is written through it lands there", async () => {
		await invoke("mount", { source: "notes", path: "notes" });
		await invoke("write_file", { path: "notes/new.md", content: "Through the mount" });

		expect(await readFile(join(notes, "new.md"), "utf8")).toBe("Through the mount");
	});

	it("refuses a source the workspace does not have", async () => {
		expect(await invoke("mount", { source: "nope", path: "here" })).toMatchObject({
			status: "error",
			error: "No source nope",
		});
	});

	it("refuses isolated mode, which only a git source can give", async () => {
		expect(await invoke("mount", { source: "notes", path: "notes", mode: "isolated" })).toMatchObject({
			error: "An isolated mount needs a git source",
		});
	});

	it("refuses a directory that is not there", async () => {
		await createSource(root, workspaceId, { name: "gone", type: "directory", config: { path: join(notes, "no") } });

		expect(await invoke("mount", { source: "gone", path: "gone" })).toMatchObject({ status: "error" });
		expect(await mountsOf()).toEqual([]);
	});

	it("refuses a path already taken, or one that nests with a mount", async () => {
		await invoke("mount", { source: "notes", path: "notes" });
		await createSource(root, workspaceId, { name: "other", type: "directory", config: { path: notes } });

		expect(await invoke("mount", { source: "other", path: "notes" })).toMatchObject({
			error: "notes is already a mount",
		});
		expect(await invoke("mount", { source: "other", path: "notes/inner" })).toMatchObject({
			error: "notes/inner is inside the mount at notes",
		});

		await mkdir(join(sandbox, "deep"), { recursive: true });
		await invoke("mount", { source: "other", path: "deep/inner" });
		expect(await invoke("mount", { source: "other", path: "deep" })).toMatchObject({
			error: "deep would contain the mount at deep/inner",
		});
	});
});

describe("a read-only mount", () => {
	beforeEach(async () => {
		await invoke("mount", { source: "notes", path: "notes", readOnly: true });
	});

	it("reads through, like any other mount", async () => {
		const call = await invoke("read_file", { path: "notes/todo.md" });

		expect(call.output).toEqual({ path: "notes/todo.md", content: "Ship it" });
	});

	it("refuses every tool that would change what is behind it", async () => {
		const write = await invoke("write_file", { path: "notes/new.md", content: "No" });
		const edit = await invoke("edit_file", { path: "notes/todo.md", find: "Ship", replace: "Drop" });
		const remove = await invoke("delete_file", { path: "notes/todo.md" });
		const move = await invoke("move_file", { from: "notes/todo.md", to: "todo.md" });

		for (const call of [write, edit, remove, move]) {
			expect(call).toMatchObject({ status: "error", error: "notes is mounted read-only" });
		}
		expect(await readFile(join(notes, "todo.md"), "utf8")).toBe("Ship it");
		expect(await readdir(notes)).toEqual(["todo.md"]);
	});

	it("refuses a move that would carry a file into it", async () => {
		await invoke("write_file", { path: "outside.md", content: "Mine" });

		expect(await invoke("move_file", { from: "outside.md", to: "notes/outside.md" })).toMatchObject({
			error: "notes is mounted read-only",
		});
	});

	it("leaves the rest of the sandbox writable", async () => {
		expect(await invoke("write_file", { path: "own.md", content: "Mine" })).toMatchObject({ status: "success" });
	});

	it("can still be unmounted, which changes nothing behind it", async () => {
		expect(await invoke("unmount", { path: "notes" })).toMatchObject({ status: "success" });
		expect(await readFile(join(notes, "todo.md"), "utf8")).toBe("Ship it");
	});
});

describe("unmount", () => {
	it("removes the link and the mount, leaving the directory behind it whole", async () => {
		await invoke("mount", { source: "notes", path: "notes" });

		const call = await invoke("unmount", { path: "notes" });

		expect(call).toMatchObject({ status: "success", output: { source: "notes", path: "notes" } });
		expect(await mountsOf()).toEqual([]);
		expect(await readFile(join(notes, "todo.md"), "utf8")).toBe("Ship it");
	});

	it("refuses a path where nothing is mounted", async () => {
		expect(await invoke("unmount", { path: "notes" })).toMatchObject({
			status: "error",
			error: "Nothing is mounted at notes",
		});
	});
});
