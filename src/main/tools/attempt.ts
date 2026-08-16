import type { ToolContext, ToolImplementation } from "./define";

export interface Attempt {
	output?: Record<string, unknown>;
	failure?: string;
}

/** Never rejects: a cancel can win the race, and a rejection nobody awaits crashes the process. */
export function attemptCall(
	tool: ToolImplementation,
	input: Record<string, unknown>,
	context: ToolContext,
): Promise<Attempt> {
	return tool.run(input, context).then(
		(output) => ({ output }),
		(failure: unknown) => ({ failure: failure instanceof Error ? failure.message : String(failure) }),
	);
}
