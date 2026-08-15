import type { BuiltinToolImplementation } from "./builtin";

export interface Attempt {
	output?: Record<string, unknown>;
	failure?: string;
}

/** Never rejects: a cancel can win the race, and a rejection nobody awaits crashes the process. */
export function attemptCall(
	builtin: BuiltinToolImplementation,
	input: Record<string, unknown>,
	sandbox: string,
): Promise<Attempt> {
	return builtin.run(input, sandbox).then(
		(output) => ({ output }),
		(failure: unknown) => ({ failure: failure instanceof Error ? failure.message : String(failure) }),
	);
}
