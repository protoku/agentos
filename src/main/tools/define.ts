import { z } from "zod";
import type { BuiltinTool } from "../../shared/types";

/** What a tool acts on: its conversation, and the sandbox that conversation owns. */
export interface ToolContext {
	root: string;
	workspaceId: string;
	conversationId: string;
	sandbox: string;
}

export interface BuiltinToolImplementation extends BuiltinTool {
	/** What the agent is given to call with, and what a user-invoked call is parsed against. */
	input: z.ZodObject;
	run(input: Record<string, unknown>, context: ToolContext): Promise<Record<string, unknown>>;
}

export const sandboxPath = z.string().describe("Path relative to the sandbox");

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
		run: (input, context) => definition.run(definition.input.parse(input), context),
	};
}
