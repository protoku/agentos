import type { EntrySink } from "../turns/run";
import type { ToolCall } from "../../shared/types";

/**
 * A call is written only once it is final, so between being made and settling it lives here and
 * nowhere else. A conversation opened while one is in flight is shown it from this.
 */
const inFlight = new Map<string, { conversationId: string; call: ToolCall }>();

/** Showing a call is also remembering it, until the status it reaches is one the file takes. */
export function show(conversationId: string, call: ToolCall, emit: EntrySink): void {
	const shown = { ...call };

	const unsettled = shown.status === "pending" || shown.status === "running";
	if (unsettled) inFlight.set(shown.id, { conversationId, call: shown });
	else inFlight.delete(shown.id);

	emit(shown);
}

export function callsInFlight(conversationId: string): ToolCall[] {
	return [...inFlight.values()]
		.filter((entry) => entry.conversationId === conversationId)
		.map((entry) => entry.call);
}
