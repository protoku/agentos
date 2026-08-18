import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invokeTool } from "./invoke";
import { git } from "../git/git";
import { archiveConversation, startConversation } from "../storage/conversations";
import { createSource } from "../storage/sources";
import { createWorkspace, loadWorkspace } from "../storage/workspaceStore";
import type { ToolCall } from "../../shared/types";

let root: string;
let remote: string;
let workspaceId: string;
let sourceId: string;
let conversationId: string;

async function conversationIn(content: string): Promise<string> {
	return (await startConversation(root, workspaceId, content)).conversation.id;
}

function invoke(conversation: string, toolId: string, input: Record<string, unknown>): Promise<ToolCall> {
	return invokeTool(root, workspaceId, conversation, toolId, input, () => {});
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agentos-"));
	remote = await mkdtemp(join(tmpdir(), "agentos-remote-"));

	await git(["init", "-b", "main", remote]);
	await git(["config", "user.email", "test@example.com"], remote);
	await git(["config", "user.name", "Test"], remote);
	await writeFile(join(remote, "README.md"), "The repository", "utf8");
	await git(["add", "."], remote);
	await git(["commit", "-m", "First"], remote);

	workspaceId = (await createWorkspace(root, "Acme API")).id;
	sourceId = (await createSource(root, workspaceId, {
		name: "api",
		type: "git",
		config: { remote, defaultBranch: "main" },
	})).id;
	conversationId = await conversationIn("Scratch work");
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
	await rm(remote, { recursive: true, force: true });
});

describe("a shared git mount", () => {
	it("clones the repository once for the workspace and links the conversation at it", async () => {
		const call = await invoke(conversationId, "mount", { source: "api", path: "api" });

		expect(call).toMatchObject({ status: "success", output: { source: "api", mode: "shared" } });
		expect(await readFile(join(root, "workspaces", workspaceId, "clones", sourceId, "README.md"), "utf8")).toBe(
			"The repository",
		);

		const read = await invoke(conversationId, "read_file", { path: "api/README.md" });
		expect(read.output).toEqual({ path: "api/README.md", content: "The repository" });
	});

	it("is the same checkout in every conversation, which is what shared means", async () => {
		const other = await conversationIn("Another");

		await invoke(conversationId, "mount", { source: "api", path: "api" });
		await invoke(other, "mount", { source: "api", path: "repo" });
		await invoke(conversationId, "write_file", { path: "api/notes.md", content: "Shared" });

		const read = await invoke(other, "read_file", { path: "repo/notes.md" });
		expect(read.output).toEqual({ path: "repo/notes.md", content: "Shared" });
	});

	it("stays on the source's default branch", async () => {
		await invoke(conversationId, "mount", { source: "api", path: "api" });

		const clone = join(root, "workspaces", workspaceId, "clones", sourceId);
		expect((await git(["branch", "--show-current"], clone)).trim()).toBe("main");
	});

	it("refuses a remote that is not there, and records no mount", async () => {
		await createSource(root, workspaceId, {
			name: "gone",
			type: "git",
			config: { remote: join(remote, "missing"), defaultBranch: "main" },
		});

		expect(await invoke(conversationId, "mount", { source: "gone", path: "gone" })).toMatchObject({
			status: "error",
		});
		expect((await loadWorkspace(root, workspaceId)).conversations[0].mounts).toEqual([]);
	});

	it("is writable, since the shared checkout is worked on in place", async () => {
		await invoke(conversationId, "mount", { source: "api", path: "api" });

		expect(await invoke(conversationId, "write_file", { path: "api/notes.md", content: "In place" })).toMatchObject({
			status: "success",
		});
	});

	it("unmounts by dropping the link, leaving the clone in place for the next mount", async () => {
		await invoke(conversationId, "mount", { source: "api", path: "api" });
		await invoke(conversationId, "unmount", { path: "api" });

		const clone = join(root, "workspaces", workspaceId, "clones", sourceId);
		expect((await stat(clone)).isDirectory()).toBe(true);
	});
});

describe("an isolated git mount", () => {
	function worktree(conversation: string, path = "api"): string {
		return join(root, "workspaces", workspaceId, "sandboxes", conversation, path);
	}

	beforeEach(async () => {
		await invoke(conversationId, "mount", { source: "api", path: "api", mode: "isolated" });
	});

	it("is a worktree of the clone, holding the same content as everyone else", async () => {
		const read = await invoke(conversationId, "read_file", { path: "api/README.md" });

		expect(read.output).toEqual({ path: "api/README.md", content: "The repository" });
		expect((await git(["worktree", "list"], clone())).includes(worktree(conversationId))).toBe(true);
	});

	it("starts on no branch, so nothing can be changed on the default branch itself", async () => {
		expect((await git(["branch", "--show-current"], worktree(conversationId))).trim()).toBe("");
		expect(await invoke(conversationId, "write_file", { path: "api/notes.md", content: "Too soon" })).toMatchObject({
			status: "error",
			error: "api is on no branch: create one before changing it",
		});
	});

	it("becomes writable once a branch is created on it", async () => {
		await git(["checkout", "-b", "work"], worktree(conversationId));

		expect(await invoke(conversationId, "write_file", { path: "api/notes.md", content: "Mine" })).toMatchObject({
			status: "success",
		});
	});

	it("keeps one conversation's work out of another's", async () => {
		const other = await conversationIn("Another");
		await invoke(other, "mount", { source: "api", path: "api", mode: "isolated" });

		await git(["checkout", "-b", "work"], worktree(conversationId));
		await invoke(conversationId, "write_file", { path: "api/notes.md", content: "Mine" });

		expect(await invoke(other, "read_file", { path: "api/notes.md" })).toMatchObject({ status: "error" });
	});

	it("discards the worktree when unmounted, and says that is what it did", async () => {
		const call = await invoke(conversationId, "unmount", { path: "api" });

		expect(call.output).toEqual({ source: "api", path: "api", mode: "isolated" });

		expect((await git(["worktree", "list"], clone())).includes(worktree(conversationId))).toBe(false);
		expect(await exists(worktree(conversationId))).toBe(false);
	});

	it("goes with the conversation when it is archived, sandbox and all", async () => {
		await archiveConversation(root, workspaceId, conversationId);

		expect((await git(["worktree", "list"], clone())).includes(worktree(conversationId))).toBe(false);
		expect(await exists(join(root, "workspaces", workspaceId, "sandboxes", conversationId))).toBe(false);
		expect((await loadWorkspace(root, workspaceId)).conversations[0].mounts).toEqual([]);
	});
});

async function commitToRemote(name: string, content: string): Promise<void> {
	await git(["config", "user.email", "test@example.com"], remote);
	await git(["config", "user.name", "Test"], remote);
	await writeFile(join(remote, name), content, "utf8");
	await git(["add", "."], remote);
	await git(["commit", "-m", `Add ${name}`], remote);
}

describe("mounting a git source", () => {
	it("starts an isolated worktree at the remote's tip, not the clone's", async () => {
		// The clone is made here, and the remote moves afterwards.
		await invoke(conversationId, "mount", { source: "api", path: "api", mode: "isolated" });
		await commitToRemote("later.md", "Written after the clone");

		const other = await conversationIn("Another");
		const call = await invoke(other, "mount", { source: "api", path: "api", mode: "isolated" });

		expect(call.output).toMatchObject({ startedFrom: "origin/main" });
		expect(await invoke(other, "read_file", { path: "api/later.md" })).toMatchObject({ status: "success" });
	});

	it("never moves a shared checkout, since other conversations are standing on it", async () => {
		await invoke(conversationId, "mount", { source: "api", path: "api" });
		await commitToRemote("later.md", "Written after the clone");

		const other = await conversationIn("Another");
		await invoke(other, "mount", { source: "api", path: "api" });

		expect(await invoke(conversationId, "read_file", { path: "api/later.md" })).toMatchObject({ status: "error" });
	});

	it("tells a shared checkout how far behind it has fallen", async () => {
		await invoke(conversationId, "mount", { source: "api", path: "api" });
		await commitToRemote("later.md", "Written after the clone");

		// A second mount fetches, which is what lets status count the distance.
		const other = await conversationIn("Another");
		await invoke(other, "mount", { source: "api", path: "repo" });

		expect((await invoke(conversationId, "git_status", { path: "api" })).output).toMatchObject({
			ahead: 0,
			behind: 1,
		});
	});
});

describe("searching a checkout", () => {
	it("skips what git ignores, and finds what it does not", async () => {
		await git(["config", "user.email", "test@example.com"], remote);
		await git(["config", "user.name", "Test"], remote);
		await writeFile(join(remote, ".gitignore"), "node_modules/\nbuilt.log\n", "utf8");
		await writeFile(join(remote, "kept.ts"), "const needle = 1;", "utf8");
		await git(["add", "."], remote);
		await git(["commit", "-m", "Ignore some things"], remote);

		await invoke(conversationId, "mount", { source: "api", path: "api" });
		const clone = join(root, "workspaces", workspaceId, "clones", sourceId);
		await mkdir(join(clone, "node_modules", "left-pad"), { recursive: true });
		await writeFile(join(clone, "node_modules", "left-pad", "index.js"), "const needle = 2;", "utf8");
		await writeFile(join(clone, "built.log"), "const needle = 3;", "utf8");
		await writeFile(join(clone, "fresh.ts"), "const needle = 4;", "utf8");

		const call = await invoke(conversationId, "search_files", { pattern: "needle", path: "api" });
		const found = (call.output?.matches as { path: string }[]).map((match) => match.path);

		// Tracked and untracked-but-not-ignored, never the ignored ones.
		expect(found.some((path) => path.endsWith("kept.ts"))).toBe(true);
		expect(found.some((path) => path.endsWith("fresh.ts"))).toBe(true);
		expect(found.some((path) => path.includes("node_modules"))).toBe(false);
		expect(found.some((path) => path.endsWith("built.log"))).toBe(false);
	});
});

describe("the git inspection tools", () => {
	beforeEach(async () => {
		await invoke(conversationId, "mount", { source: "api", path: "api" });
	});

	it("report the branch and what changed on the mount", async () => {
		await invoke(conversationId, "write_file", { path: "api/notes.md", content: "Mine" });

		const call = await invoke(conversationId, "git_status", { path: "api" });

		expect(call.output).toEqual({
			path: "api",
			branch: "main",
			ahead: 0,
			behind: 0,
			changes: [{ change: "??", file: "notes.md" }],
		});
	});

	it("show the changes themselves", async () => {
		await invoke(conversationId, "write_file", { path: "api/README.md", content: "Changed" });

		const call = await invoke(conversationId, "git_diff", { path: "api" });

		expect(String(call.output?.diff)).toContain("-The repository");
		expect(String(call.output?.diff)).toContain("+Changed");
	});

	it("read the history of the branch the mount is on", async () => {
		const call = await invoke(conversationId, "git_log", { path: "api" });

		expect(call.output?.commits).toMatchObject([{ author: "Test", subject: "First" }]);
	});

	it("refuse a path where nothing is mounted, and one that is no repository", async () => {
		expect(await invoke(conversationId, "git_status", { path: "nowhere" })).toMatchObject({
			error: "Nothing is mounted at nowhere",
		});

		const notes = await mkdtemp(join(tmpdir(), "agentos-notes-"));
		await createSource(root, workspaceId, { name: "notes", type: "directory", config: { path: notes } });
		await invoke(conversationId, "mount", { source: "notes", path: "notes" });

		expect(await invoke(conversationId, "git_status", { path: "notes" })).toMatchObject({
			error: "notes is not a git mount",
		});
		await rm(notes, { recursive: true, force: true });
	});
});

function clone(): string {
	return join(root, "workspaces", workspaceId, "clones", sourceId);
}

async function exists(path: string): Promise<boolean> {
	return stat(path).then(
		() => true,
		() => false,
	);
}
