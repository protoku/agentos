import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invokeTool } from "./invoke";
import { git } from "../git/git";
import { archiveConversation, startConversation } from "../storage/conversations";
import { createSource } from "../storage/sources";
import { createWorkspace } from "../storage/workspaceStore";
import type { ToolCall } from "../../shared/types";

let root: string;
let remote: string;
let workspaceId: string;
let sourceId: string;
let conversationId: string;

function invoke(toolId: string, input: Record<string, unknown>, conversation = conversationId): Promise<ToolCall> {
	return invokeTool(root, workspaceId, conversation, toolId, input, () => {});
}

function clone(): string {
	return join(root, "workspaces", workspaceId, "clones", sourceId);
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agentos-"));
	remote = await mkdtemp(join(tmpdir(), "agentos-remote-"));
	const seed = await mkdtemp(join(tmpdir(), "agentos-seed-"));

	// A bare remote, so pushing to it behaves like a real one.
	await git(["init", "--bare", "-b", "main", remote]);
	await git(["init", "-b", "main", seed]);
	await git(["config", "user.email", "test@example.com"], seed);
	await git(["config", "user.name", "Test"], seed);
	await writeFile(join(seed, "README.md"), "The repository", "utf8");
	await git(["add", "."], seed);
	await git(["commit", "-m", "First"], seed);
	await git(["push", remote, "main"], seed);
	await rm(seed, { recursive: true, force: true });

	workspaceId = (await createWorkspace(root, "Acme API")).id;
	sourceId = (
		await createSource(root, workspaceId, { name: "api", type: "git", config: { remote, defaultBranch: "main" } })
	).id;
	conversationId = (await startConversation(root, workspaceId, "Ship a change")).conversation.id;
	await invoke("mount", { source: "api", path: "api", mode: "isolated" });
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
	await rm(remote, { recursive: true, force: true });
});

describe("branch, commit, push", () => {
	it("carries work from an isolated mount to the remote", async () => {
		const branched = await invoke("git_create_branch", { path: "api", name: "work" });
		await invoke("write_file", { path: "api/notes.md", content: "Mine" });
		const committed = await invoke("git_commit", { path: "api", message: "Add notes" });
		const pushed = await invoke("git_push", { path: "api" });

		expect(branched.output).toEqual({ path: "api", branch: "work" });
		expect(committed).toMatchObject({ status: "success", output: { branch: "work", message: "Add notes" } });
		expect(pushed).toMatchObject({ status: "success", output: { branch: "work" } });
		expect(await git(["log", "--pretty=%s", "-n1", "work"], remote)).toContain("Add notes");
	});

	it("pulls only once the branch has an upstream", async () => {
		await invoke("git_create_branch", { path: "api", name: "work" });

		expect(await invoke("git_pull", { path: "api" })).toMatchObject({
			status: "error",
			error: "work has never been pushed, so there is nothing to pull from yet",
		});

		await invoke("write_file", { path: "api/notes.md", content: "Mine" });
		await invoke("git_commit", { path: "api", message: "Add notes" });
		await invoke("git_push", { path: "api" });

		expect(await invoke("git_pull", { path: "api" })).toMatchObject({ status: "success" });
	});

	it("refuses a commit before a branch exists, since work never starts on the default branch", async () => {
		expect(await invoke("git_commit", { path: "api", message: "Too soon" })).toMatchObject({
			error: "api is on no branch: create one first",
		});
	});

	it("takes a branch with the mount, leaving what was pushed on the remote", async () => {
		await invoke("git_create_branch", { path: "api", name: "work" });
		await invoke("write_file", { path: "api/notes.md", content: "Mine" });
		await invoke("git_commit", { path: "api", message: "Add notes" });
		await invoke("git_push", { path: "api" });

		await archiveConversation(root, workspaceId, conversationId);

		expect(await git(["branch", "--list", "work"], clone())).toBe("");
		expect(await git(["log", "--pretty=%s", "-n1", "work"], remote)).toContain("Add notes");
	});

	it("takes an unpushed branch too, which is why only pushed work survives", async () => {
		await invoke("git_create_branch", { path: "api", name: "work" });
		await invoke("write_file", { path: "api/notes.md", content: "Mine" });
		await invoke("git_commit", { path: "api", message: "Never pushed" });

		await invoke("unmount", { path: "api" });

		expect(await git(["branch", "--list", "work"], clone())).toBe("");
	});
});

describe("git_checkout", () => {
	it("reaches a branch that exists only on the remote", async () => {
		await invoke("git_create_branch", { path: "api", name: "work" });
		await invoke("write_file", { path: "api/notes.md", content: "Mine" });
		await invoke("git_commit", { path: "api", message: "Add notes" });
		await invoke("git_push", { path: "api" });
		// Discards that worktree and its local branch, so only the remote still has the work.
		await invoke("unmount", { path: "api" });

		// A conversation that has never heard of that branch.
		const other = (await startConversation(root, workspaceId, "Continuing")).conversation.id;
		await invoke("mount", { source: "api", path: "api", mode: "isolated" }, other);

		const call = await invoke("git_checkout", { path: "api", name: "work" }, other);

		expect(call).toMatchObject({ status: "success", output: { branch: "work" } });
		expect(await invoke("read_file", { path: "api/notes.md" }, other)).toMatchObject({ status: "success" });
	});

	it("refuses a branch another worktree is already holding", async () => {
		await invoke("git_create_branch", { path: "api", name: "work" });

		const other = (await startConversation(root, workspaceId, "Fighting over it")).conversation.id;
		await invoke("mount", { source: "api", path: "api", mode: "isolated" }, other);

		expect(await invoke("git_checkout", { path: "api", name: "work" }, other)).toMatchObject({ status: "error" });
	});

	it("is not for a shared mount, which never leaves its default branch", async () => {
		const other = (await startConversation(root, workspaceId, "Shared")).conversation.id;
		await invoke("mount", { source: "api", path: "api" }, other);

		expect(await invoke("git_checkout", { path: "api", name: "main" }, other)).toMatchObject({
			error: "api is a shared mount, which never leaves its default branch",
		});
	});

	it("leaves a visited branch alone when the conversation is archived", async () => {
		await invoke("git_create_branch", { path: "api", name: "work" });
		await invoke("write_file", { path: "api/notes.md", content: "Mine" });
		await invoke("git_commit", { path: "api", message: "Add notes" });
		await invoke("git_push", { path: "api" });

		const other = (await startConversation(root, workspaceId, "Visiting")).conversation.id;
		await invoke("mount", { source: "api", path: "api", mode: "isolated" }, other);
		await invoke("git_checkout", { path: "api", name: "work" }, other);
		await archiveConversation(root, workspaceId, other);

		// It created nothing, so it destroys nothing: the branch is still on the remote.
		expect(await git(["log", "--pretty=%s", "-n1", "work"], remote)).toContain("Add notes");
	});
});

describe("what a mount's mode and readOnly allow", () => {
	it("keeps a shared mount on its default branch, so it never branches", async () => {
		const other = (await startConversation(root, workspaceId, "Shared work")).conversation.id;
		await invoke("mount", { source: "api", path: "api" }, other);

		expect(await invoke("git_create_branch", { path: "api", name: "work" }, other)).toMatchObject({
			error: "api is a shared mount, which never leaves its default branch",
		});
	});

	it("commits on a shared mount directly, which is what choosing shared means", async () => {
		const other = (await startConversation(root, workspaceId, "Shared work")).conversation.id;
		await invoke("mount", { source: "api", path: "api" }, other);
		await invoke("write_file", { path: "api/shared.md", content: "In place" }, other);

		expect(await invoke("git_commit", { path: "api", message: "Straight to main" }, other)).toMatchObject({
			status: "success",
			output: { branch: "main" },
		});
	});

	it("leaves the mutating tools unavailable on a read-only mount", async () => {
		const other = (await startConversation(root, workspaceId, "Reading only")).conversation.id;
		await invoke("mount", { source: "api", path: "api", readOnly: true }, other);

		expect(await invoke("git_commit", { path: "api", message: "No" }, other)).toMatchObject({
			error: "api is mounted read-only",
		});
		expect(await invoke("git_push", { path: "api" }, other)).toMatchObject({ error: "api is mounted read-only" });
		expect(await invoke("git_status", { path: "api" }, other)).toMatchObject({ status: "success" });
	});
});
