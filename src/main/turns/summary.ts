import { randomUUID } from "node:crypto";
import { z } from "zod";
import { appendEntry } from "../storage/conversationFile";
import { define, type BuiltinToolImplementation } from "../tools/define";
import type { CallContext } from "./tools";
import type { Summary } from "../../shared/types";

export const writeSummaryId = "write_summary";

/** Lent only for the turn a summary was asked for; what it writes is handled where calls are recorded. */
export const summaryTools: BuiltinToolImplementation[] = [
	define({
		id: writeSummaryId,
		description:
			"Write the summary the user asked for. Every later turn is sent this summary instead of everything " +
			"before it, so it must hold what is needed to carry on seamlessly, shaped by what the user asked to keep.",
		input: z.object({ summary: z.string().describe("The summary, in markdown") }),
		outputSchema: { type: "object", properties: {} },
		async run() {
			throw new Error("A summary is written only in the turn it was asked for");
		},
	}),
];

/** The summary is the whole of its call, so it lands as the summary itself rather than as a call beside it. */
export async function writeSummary(summary: string, context: CallContext): Promise<Summary> {
	const written: Summary = {
		type: "summary",
		id: randomUUID(),
		agentId: context.agentId,
		turnId: context.turnId,
		content: summary,
		createdAt: new Date().toISOString(),
	};
	await appendEntry(context.file, written);
	context.emit(written);

	return written;
}
