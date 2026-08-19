import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sandboxDiff } from "./diff";
import { invokeTool } from "./invoke";
import { git } from "../git/git";
import { startConversation } from "../storage/conversations";
import { createSource } from "../storage/sources";
import { createWorkspace } from "../storage/workspaceStore";

let root: string;
let remote: string;
let workspaceId: string;
let conversationId: string;

function invoke(toolId: string, input: Record<string, unknown>) {
	return invokeTool(root, workspaceId, conversationId, toolId, input, () => {});
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agentos-"));
	remote = await mkdtemp(join(tmpdir(), "agentos-remote-"));

	await git(["init", "-b", "main", remote]);
	await git(["config", "user.email", "test@example.com"], remote);
	await git(["config", "user.name", "Test"], remote);
	await writeFile(join(remote, "README.md"), "The repository\n", "utf8");
	await git(["add", "."], remote);
	await git(["commit", "-m", "First"], remote);

	workspaceId = (await createWorkspace(root, "Acme API")).id;
	await createSource(root, workspaceId, { name: "api", type: "git", config: { remote, defaultBranch: "main" } });
	conversationId = (await startConversation(root, workspaceId, "Changing things")).conversation.id;
	await invoke("mount", { source: "api", path: "api", mode: "isolated" });
	await invoke("git_create_branch", { path: "api", name: "work" });
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
	await rm(remote, { recursive: true, force: true });
});

describe("sandboxDiff", () => {
	it("shows what the working tree has that the last commit does not", async () => {
		await invoke("edit_file", { path: "api/README.md", find: "The repository", replace: "The repository, changed" });

		const changes = await sandboxDiff(root, workspaceId, conversationId, "api");

		expect(changes.diff).toContain("-The repository");
		expect(changes.diff).toContain("+The repository, changed");
	});

	it("shows a file git has never heard of as every line added", async () => {
		await invoke("write_file", { path: "api/notes.md", content: "New\n" });

		const changes = await sandboxDiff(root, workspaceId, conversationId, "api");

		expect(changes.diff).toContain("notes.md");
		expect(changes.diff).toContain("+New");
		expect(changes.untracked).toEqual(["notes.md"]);
	});

	it("says nothing changed when nothing has", async () => {
		const changes = await sandboxDiff(root, workspaceId, conversationId, "api");

		expect(changes.diff.trim()).toBe("");
		expect(changes.untracked).toEqual([]);
	});
});
