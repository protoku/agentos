import { z } from "zod";
import type { BuiltinTool } from "../../shared/types";

/** What a tool acts on: its conversation, and the sandbox that conversation owns. */
export interface ToolTarget {
	root: string;
	workspaceId: string;
	conversationId: string;
	sandbox: string;
}

export interface ToolContext extends ToolTarget {
	/** Aborted when the call is canceled, so the work behind it stops rather than running on. */
	signal: AbortSignal;
}

/** What every tool offers a caller, whichever kind it is. */
export interface ToolImplementation {
	id: string;
	name: string;
	description: string;
	/** What the agent is given to call with, and what a user-invoked call is parsed against. */
	input: z.ZodObject;
	run(input: Record<string, unknown>, context: ToolContext): Promise<Record<string, unknown>>;
}

export interface BuiltinToolImplementation extends BuiltinTool, ToolImplementation {}

export const sandboxPath = z.string().describe("Path relative to the sandbox").meta({ render: "path" });

export function define<Input extends z.ZodObject>(definition: {
	id: string;
	description: string;
	input: Input;
	outputSchema: Record<string, unknown>;
	run(input: z.infer<Input>, context: ToolContext): Promise<Record<string, unknown>>;
}): BuiltinToolImplementation {
	return {
		type: "builtin",
		id: definition.id,
		name: definition.id,
		description: definition.description,
		// The input side: a defaulted argument is one the caller may leave out.
		inputSchema: z.toJSONSchema(definition.input, { io: "input" }),
		outputSchema: definition.outputSchema,
		input: definition.input,
		run: (input, context) => definition.run(parse(definition, input), context),
	};
}

/** The caller reads this in the thread, so a mistyped call says what is wrong in words. */
function parse<Input extends z.ZodObject>(
	definition: { id: string; input: Input },
	input: Record<string, unknown>,
): z.infer<Input> {
	const parsed = definition.input.safeParse(input);
	if (parsed.success) return parsed.data;

	const problems = parsed.error.issues.map((issue) => {
		const argument = issue.path.join(".");
		if (argument.length === 0) return issue.message;

		return input[String(issue.path[0])] === undefined
			? `${argument} is required`
			: `${argument} ${issue.message.replace(/^Invalid input: /, "")}`;
	});

	return raise(`${definition.id} was called with ${problems.join(", ")}`);
}

function raise(message: string): never {
	throw new Error(message);
}
