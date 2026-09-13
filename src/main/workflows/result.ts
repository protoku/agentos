import { z } from "zod";
import { define, type BuiltinToolImplementation } from "./../tools/define";

/** What the step being taken right now is waiting to be handed, one conversation at a time. */
const declaring = new Map<string, { asked: boolean; result?: Record<string, unknown> }>();

/** Opened while a step that declares a result runs, and read once its agent's turn is over. */
export function asking(conversationId: string): void {
	declaring.set(conversationId, { asked: true });
}

export function declared(conversationId: string): Record<string, unknown> | undefined {
	const slot = declaring.get(conversationId);
	declaring.delete(conversationId);

	return slot?.result;
}

export const resultTools: BuiltinToolImplementation[] = [
	define({
		id: "workflow_result",
		description:
			"Declare what this step of the workflow was asked for. Call it once, when you have it: " +
			"the step ends with what you declare, and the run carries it to the steps after this one.",
		input: z.object({ result: z.record(z.string(), z.unknown()).describe("The fields the step asked for") }),
		outputSchema: {
			type: "object",
			properties: { declared: { type: "boolean" } },
			required: ["declared"],
		},
		async run({ result }, context) {
			const slot = declaring.get(context.conversationId);
			if (slot === undefined) throw new Error("No step of a workflow is asking you for a result");

			slot.result = result;

			return { declared: true };
		},
	}),
];
