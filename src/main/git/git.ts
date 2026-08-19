import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Git runs as the machine's own git: its config, its keys, its credentials, never the workspace env. */
export async function git(args: string[], cwd?: string): Promise<string> {
	try {
		const { stdout } = await run("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });

		return stdout;
	} catch (failure) {
		throw new Error(reasonOf(failure));
	}
}

/**
 * Some git commands report what they found through their exit code, so a difference is not a
 * failure and its output is the answer. Anything that truly failed comes back as nothing.
 */
export async function gitReading(args: string[], cwd?: string): Promise<string> {
	return run("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 }).then(
		({ stdout }) => stdout,
		(failure: { stdout?: string }) => String(failure.stdout ?? ""),
	);
}

function reasonOf(failure: unknown): string {
	if (typeof failure === "object" && failure !== null && "stderr" in failure) {
		const stderr = String(failure.stderr).trim();
		if (stderr.length > 0) return stderr;
	}

	return failure instanceof Error ? failure.message : String(failure);
}
