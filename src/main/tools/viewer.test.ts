import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureSandbox } from "./sandbox";
import { viewSandboxPath } from "./viewer";
import { startConversation } from "../storage/conversations";
import { createWorkspace } from "../storage/workspaceStore";

let root: string;
let workspaceId: string;
let conversationId: string;
let sandbox: string;
let outside: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agentos-"));
	outside = await mkdtemp(join(tmpdir(), "agentos-notes-"));

	workspaceId = (await createWorkspace(root, "Acme API")).id;
	conversationId = (await startConversation(root, workspaceId, "Scratch work")).conversation.id;
	sandbox = await ensureSandbox(root, workspaceId, conversationId);
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
	await rm(outside, { recursive: true, force: true });
});

function view(path: string) {
	return viewSandboxPath(root, workspaceId, conversationId, path);
}

describe("viewSandboxPath", () => {
	it("lists a directory with its folders first, each group by name", async () => {
		await mkdir(join(sandbox, "clusters"));
		await mkdir(join(sandbox, "apps"));
		await writeFile(join(sandbox, "notes.md"), "Ship it", "utf8");
		await writeFile(join(sandbox, "README.md"), "Read me", "utf8");

		expect(await view("")).toMatchObject({
			kind: "directory",
			entries: [
				{ name: "apps", directory: true },
				{ name: "clusters", directory: true },
				{ name: "notes.md", directory: false },
				{ name: "README.md", directory: false },
			],
		});
	});

	it("reads a mount as the folder behind it, since a mount is a symlink", async () => {
		await writeFile(join(outside, "todo.md"), "Ship it", "utf8");
		await symlink(outside, join(sandbox, "notes"));

		expect(await view("")).toMatchObject({ entries: [{ name: "notes", directory: true }] });
		expect(await view("notes")).toMatchObject({ entries: [{ name: "todo.md", directory: false }] });
	});

	it("reads a text file whole, and says so when it shows only the first of it", async () => {
		await writeFile(join(sandbox, "todo.md"), "Ship it", "utf8");
		await writeFile(join(sandbox, "long.txt"), "x".repeat(300 * 1024), "utf8");

		expect(await view("todo.md")).toMatchObject({ kind: "text", content: "Ship it", truncated: false });

		const long = await view("long.txt");
		expect(long).toMatchObject({ kind: "text", truncated: true });
		expect(long.kind === "text" && long.content.length).toBe(256 * 1024);
	});

	it("says what is not text, and what is not there", async () => {
		await writeFile(join(sandbox, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));

		expect(await view("logo.png")).toMatchObject({ kind: "binary", bytes: 6 });
		expect(await view("gone.md")).toMatchObject({ kind: "missing", path: "gone.md" });
	});
});
