import { git } from "./git";
import type { Entry } from "../../shared/types";

export const createBranchTool = "git_create_branch";

/** Which branches a mount created, read back from the calls that created them in the thread. */
export function branchesCreatedOn(entries: Entry[], mountPath: string): string[] {
	const branches: string[] = [];

	for (const entry of entries) {
		if (entry.type !== "toolCall" || entry.toolId !== createBranchTool || entry.status !== "success") continue;
		if (entry.input.path !== mountPath) continue;

		const branch = entry.output?.branch;
		if (typeof branch === "string" && !branches.includes(branch)) branches.push(branch);
	}

	return branches;
}

/** Gone with the worktree that held them: what was pushed lives on the remote, nothing else survives. */
export async function deleteBranches(clone: string, branches: string[]): Promise<void> {
	for (const branch of branches) {
		await git(["branch", "-D", branch], clone).catch(() => undefined);
	}
}
