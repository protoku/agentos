import { z } from "zod";
import { define, type BuiltinToolImplementation } from "./define";
import { invokeTool } from "./invoke";
import { mountInput } from "./mounts";
import { toolNamed } from "./registry";
import { createConversation, listConversations, renameConversation, sendMessage } from "../storage/conversations";
import { listWorkflows } from "../storage/workflows";
import { runMentionedTurns, type EntrySink } from "../turns/run";
import { runWorkflow } from "../workflows/run";
import { parseSlashCommand, parseSummarize } from "../../shared/slash";

/** How an opened conversation's entries reach the window; main sets this, tests leave it silent. */
let sinkFor: (workspaceId: string, conversationId: string) => EntrySink = () => () => {};

export function showOpenedConversationsWith(sink: (workspaceId: string, conversationId: string) => EntrySink): void {
	sinkFor = sink;
}

export const conversationTools: BuiltinToolImplementation[] = [
	// The only thing a tool can change about the conversation it is acting in: what it is called.
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
	define({
		id: "create_conversation",
		description:
			"Open a new conversation in this workspace and start it with a prompt, exactly as the user would type it " +
			"into a new conversation: a message whose @mentions start those agents' turns, a /tool call with key=value " +
			"arguments, or a /workflow started by its name. Mounts are attached before the prompt is sent. The call " +
			"returns once the prompt is sent; the new conversation runs on its own.",
		input: z.object({
			prompt: z.string().describe("What the new conversation starts with, as typed into its composer"),
			title: z.string().optional().describe("What the conversation is called, taken from the prompt if left out"),
			mounts: z.array(mountInput).optional().describe("Sources to mount before the prompt is sent"),
		}),
		outputSchema: {
			type: "object",
			properties: {
				conversationId: { type: "string" },
				title: { type: "string" },
				started: { enum: ["message", "tool", "workflow"] },
			},
			required: ["conversationId", "title", "started"],
		},
		async run({ prompt, title, mounts = [] }, context) {
			const { root, workspaceId } = context;
			const start = await startOf(root, workspaceId, prompt);

			const conversation = await createConversation(root, workspaceId, title ?? prompt);
			const emit = sinkFor(workspaceId, conversation.id);

			for (const mount of mounts) {
				const call = await invokeTool(root, workspaceId, conversation.id, "mount", mount, emit);
				if (call.status !== "success") {
					throw new Error(
						`Mounting ${mount.source} failed in the new conversation "${conversation.title}" ` +
							`(${conversation.id}), so its prompt was not sent: ${call.error ?? call.status}`,
					);
				}
			}

			// Started and let go: the new conversation runs alongside this one rather than inside its call.
			if (start.kind === "message") {
				const message = await sendMessage(root, workspaceId, conversation.id, prompt);
				emit(message);
				if (message.mentions !== undefined) {
					void runMentionedTurns(root, workspaceId, conversation.id, message.mentions, emit);
				}
			} else if (start.kind === "workflow") {
				void runWorkflow(root, workspaceId, conversation.id, start.workflow, start.input, emit);
			} else {
				void invokeTool(root, workspaceId, conversation.id, start.toolId, start.input, emit);
			}

			return { conversationId: conversation.id, title: conversation.title, started: start.kind };
		},
	}),
];

/** What the prompt starts, settled before anything exists so that a prompt nobody can run leaves no trace. */
async function startOf(root: string, workspaceId: string, prompt: string) {
	if (prompt.trim().length === 0) throw new Error("A new conversation needs a prompt to start with");
	if (parseSummarize(prompt) !== undefined) throw new Error("A new conversation holds nothing to summarize yet");

	const command = parseSlashCommand(prompt);
	if (command === undefined) return { kind: "message" as const };

	const workflow = (await listWorkflows(root, workspaceId)).find((candidate) => candidate.name === command.toolId);
	if (workflow !== undefined) return { kind: "workflow" as const, workflow, input: command.input };

	const tool = await toolNamed(root, workspaceId, command.toolId);

	return { kind: "tool" as const, toolId: tool.id, input: command.input };
}
