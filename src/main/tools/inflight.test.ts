import { describe, expect, it } from "vitest";
import { callsInFlight, show } from "./inflight";
import type { Entry, ToolCall } from "../../shared/types";

function call(id: string, status: ToolCall["status"]): ToolCall {
	return { type: "toolCall", id, toolId: "write_file", input: {}, status, createdAt: "2026-09-13T10:00:00.000Z" };
}

describe("show", () => {
	it("remembers a call nobody has written yet, for the conversation it was made in", () => {
		show("conversation-1", call("call-1", "pending"), () => {});
		show("conversation-1", call("call-2", "running"), () => {});
		show("conversation-2", call("call-3", "running"), () => {});

		expect(callsInFlight("conversation-1").map((shown) => shown.id)).toEqual(["call-1", "call-2"]);
		expect(callsInFlight("conversation-2").map((shown) => shown.id)).toEqual(["call-3"]);
		expect(callsInFlight("conversation-3")).toEqual([]);
	});

	it("forgets a call the moment it reaches a status the file takes", () => {
		show("conversation-4", call("call-4", "pending"), () => {});
		show("conversation-4", { ...call("call-4", "denied"), decidedAt: "2026-09-13T10:00:01.000Z" }, () => {});

		expect(callsInFlight("conversation-4")).toEqual([]);
	});

	it("shows the call as it stands, so a later change is not a change to what was shown", () => {
		const shown: Entry[] = [];
		const running = call("call-5", "running");

		show("conversation-5", running, (entry) => shown.push(entry));
		running.status = "success";

		expect(shown).toEqual([call("call-5", "running")]);
		expect(callsInFlight("conversation-5")).toEqual([call("call-5", "running")]);
	});
});
