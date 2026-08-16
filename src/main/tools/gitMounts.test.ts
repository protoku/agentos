import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invokeTool } from "./invoke";
import { git } from "../git/git";
import { startConversation } from "../storage/conversations";
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

	it("unmounts by dropping the link, leaving the clone in place for the next mount", async () => {
		await invoke(conversationId, "mount", { source: "api", path: "api" });
		await invoke(conversationId, "unmount", { path: "api" });

		const clone = join(root, "workspaces", workspaceId, "clones", sourceId);
		expect((await stat(clone)).isDirectory()).toBe(true);
	});
});
