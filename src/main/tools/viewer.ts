import { readFile, readdir, stat } from "node:fs/promises";
import { ensureSandbox, resolveInSandbox } from "./sandbox";
import type { SandboxView } from "../../shared/api";

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
		const entries = await readdir(resolved);

		return { kind: "directory", path, entries: entries.sort() };
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

/** A null byte in the first stretch of a file is what a text editor takes for binary too. */
function isBinary(content: Buffer): boolean {
	return content.subarray(0, 4096).includes(0);
}
