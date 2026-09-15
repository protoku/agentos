import { z } from "zod";
import { define, type BuiltinToolImplementation } from "./define";
import { listConversations, renameConversation } from "../storage/conversations";

/** The only thing a tool can change about the conversation it is acting in: what it is called. */
export const conversationTools: BuiltinToolImplementation[] = [
	define({
		id: "rename_conversation",
		description: "Give this conversation a new title, which is the label it is found by.",
		input: z.object({ title: z.string().describe("What this conversation should be called") }),
		outputSchema: {
			type: "object",
			properties: { title: { type: "string" }, previous: { type: "string" } },
			required: ["title", "previous"],
		},
		async run({ title }, context) {
			// What it was called is recorded nowhere else, so the call itself carries it.
			const conversations = await listConversations(context.root, context.workspaceId);
			const previous = conversations.find((candidate) => candidate.id === context.conversationId);
			if (previous === undefined) throw new Error("This conversation is not there");

			const renamed = await renameConversation(
				context.root,
				context.workspaceId,
				context.conversationId,
				title,
			);

			return { title: renamed.title, previous: previous.title };
		},
	}),
];
