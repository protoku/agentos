import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const marker = "__agentos_path__";

/**
 * A window opened from Finder, the Dock or a desktop launcher inherits a stub PATH, so a version
 * manager's node, or anything else a shell profile puts on the path, is invisible to every command
 * a tool spawns and to git's own hooks. Asking the login shell what its PATH is puts that right,
 * once, before anything runs.
 */
export async function adoptShellPath(): Promise<void> {
	if (process.platform === "win32") return;

	const found = await askTheShell().catch(() => undefined);
	if (found !== undefined && found.length > 0) process.env.PATH = found;
}

async function askTheShell(): Promise<string | undefined> {
	const shell = process.env.SHELL;
	if (shell === undefined || shell.length === 0) return undefined;

	// Interactive and login, since that is where a profile sources a version manager. The marker
	// picks our line out of whatever else a profile decides to print on the way.
	const { stdout } = await run(shell, ["-ilc", `printf "${marker}%s${marker}" "$PATH"`], {
		timeout: 5000,
		maxBuffer: 1024 * 1024,
	});

	return pathFrom(stdout);
}

/** A profile is free to print a greeting on the way, so the answer is fetched out from between markers. */
export function pathFrom(said: string): string | undefined {
	const [, found] = said.split(marker);

	return found === undefined || found.trim().length === 0 ? undefined : found.trim();
}
