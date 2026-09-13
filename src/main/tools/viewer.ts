import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { ensureSandbox, resolveInSandbox } from "./sandbox";
import type { SandboxEntry, SandboxView } from "../../shared/api";

/** Enough of a file to read, not enough to freeze the window. */
const readable = 256 * 1024;

/** What the viewer shows: the file as it is now, never a handle to change it. */
export async function viewSandboxPath(
	root: string,
	workspaceId: string,
	conversationId: string,
	path: string,
): Promise<SandboxView> {
	const sandbox = await ensureSandbox(root, workspaceId, conversationId);
	const resolved = resolveInSandbox(sandbox, path);

	const found = await stat(resolved).catch(() => undefined);
	if (found === undefined) return { kind: "missing", path };

	if (found.isDirectory()) {
		return { kind: "directory", path, entries: await entriesOf(resolved) };
	}

	const content = await readFile(resolved);
	if (isBinary(content)) return { kind: "binary", path, bytes: found.size };

	return {
		kind: "text",
		path,
		content: content.subarray(0, readable).toString("utf8"),
		truncated: content.byteLength > readable,
	};
}

/** Folders first, each group by name, which is the order a tree of them reads in. */
async function entriesOf(resolved: string): Promise<SandboxEntry[]> {
	const found = await readdir(resolved, { withFileTypes: true });
	const entries = await Promise.all(
		found.map(async (entry) => ({
			name: entry.name,
			// A mount is a symlink, and leads into the directory behind it like any other folder.
			directory: entry.isSymbolicLink() ? await leadsIn(join(resolved, entry.name)) : entry.isDirectory(),
		})),
	);

	return entries.sort(
		(one, other) => Number(other.directory) - Number(one.directory) || one.name.localeCompare(other.name),
	);
}

async function leadsIn(path: string): Promise<boolean> {
	return (await stat(path).catch(() => undefined))?.isDirectory() ?? false;
}

/** A null byte in the first stretch of a file is what a text editor takes for binary too. */
function isBinary(content: Buffer): boolean {
	return content.subarray(0, 4096).includes(0);
}
