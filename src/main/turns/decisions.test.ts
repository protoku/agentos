import { describe, expect, it } from "vitest";
import { awaitDecision, decide } from "./decisions";

describe("decisions", () => {
	it("hands the waiting call what the user ruled", async () => {
		const waiting = awaitDecision("call-1");
		decide("call-1", { allowed: false, denyMessage: "not that file" });

		expect(await waiting).toEqual({ allowed: false, denyMessage: "not that file" });
	});

	it("refuses a call that is not waiting, so a stale decision is never silently dropped", () => {
		expect(() => decide("call-2", { allowed: true })).toThrow("No call call-2 is waiting");
	});

	it("refuses a second decision on the same call", async () => {
		const waiting = awaitDecision("call-3");
		decide("call-3", { allowed: true });
		await waiting;

		expect(() => decide("call-3", { allowed: true })).toThrow();
	});
});
