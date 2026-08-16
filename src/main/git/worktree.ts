import { rm } from "node:fs/promises";
import { git } from "./git";

/** An isolated mount is its own worktree of the base clone, detached at the tip of a branch. */
export async function addWorktree(clone: string, path: string, at: string): Promise<void> {
	await git(["worktree", "add", "--detach", path, at], clone);
}

/** Discarded whole, so whatever was never pushed goes with it. */
export async function removeWorktree(clone: string, path: string): Promise<void> {
	await git(["worktree", "remove", "--force", path], clone).catch(async () => {
		await rm(path, { recursive: true, force: true });
		await git(["worktree", "prune"], clone);
	});
}

/** No branch means a detached head: work has not begun, and the mount is still read-only. */
export async function currentBranch(worktree: string): Promise<string | undefined> {
	const name = (await git(["branch", "--show-current"], worktree)).trim();

	return name.length === 0 ? undefined : name;
}
