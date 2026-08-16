import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const executable = process.platform === "win32" ? "claude.exe" : "claude";

export const claudeCodeMissing = [
	"Claude Code was not found on this machine.",
	"AgentOS runs its agents on the Claude Code you already have, signed in as you are:",
	"install it from https://claude.com/download, sign in, then restart AgentOS.",
].join(" ");

let located: string | undefined;

/** Found once and kept: nothing moves it while the app runs. */
export async function claudeCodePath(): Promise<string | undefined> {
	if (located !== undefined) return located;

	for (const candidate of candidates()) {
		if (await isExecutable(candidate)) return (located = candidate);
	}

	return undefined;
}

/**
 * PATH first, then where Claude Code puts itself. A window opened from a desktop launcher
 * inherits a far shorter PATH than a shell does, so PATH alone would find it only sometimes.
 */
function candidates(): string[] {
	const home = homedir();
	const onPath = (process.env.PATH ?? "")
		.split(delimiter)
		.filter((directory) => directory.length > 0)
		.map((directory) => join(directory, executable));

	if (process.platform === "win32") {
		const local = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");

		return [...onPath, join(local, "Programs", "claude", executable), join(home, ".local", "bin", executable)];
	}

	return [
		...onPath,
		join(home, ".local", "bin", executable),
		join(home, ".claude", "local", executable),
		join(home, ".bun", "bin", executable),
		"/usr/local/bin/" + executable,
		"/opt/homebrew/bin/" + executable,
		"/usr/bin/" + executable,
	];
}

async function isExecutable(path: string): Promise<boolean> {
	return access(path, constants.X_OK).then(
		() => true,
		() => false,
	);
}
