import { z } from "zod";
import { define, type BuiltinToolImplementation } from "./define";

/** The one tool whose work is a question: its call waits in the thread, and the answers are its output. */
export const askUserId = "ask_user";

const option = z.object({
	label: z.string().describe("The answer as the user reads it, a few words"),
	description: z.string().optional().describe("What choosing it means, one line"),
});

const question = z.object({
	id: z.string().describe("Short key the answer comes back under, letters, digits and underscores"),
	question: z.string().describe("What you are asking, in full"),
	header: z.string().optional().describe("Two or three words naming what the question is about"),
	options: z.array(option).min(2).max(4).describe("The answers you have prepared"),
	multiple: z.boolean().optional().describe("Whether several answers may be picked at once"),
});

export const askUserTools: BuiltinToolImplementation[] = [
	define({
		id: askUserId,
		description:
			"Ask the user, with answers prepared. Use it when what you need is a decision or something " +
			"only they know, rather than something you could read or work out.",
		input: z.object({ questions: z.array(question).min(1).max(4) }),
		outputSchema: {
			type: "object",
			description: "What the user answered, under the id of each question",
		},
		// The call is answered in the thread rather than run here, which is what waiting means.
		run: async () => ({}),
	}),
];
