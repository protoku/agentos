import { describe, expect, it } from "vitest";
import { awaitRuling, cancelRulings, rule } from "./decisions";

describe("rulings", () => {
	it("hands the waiting call what the user ruled", async () => {
		const waiting = awaitRuling("call-1", "turn-1");
		rule("call-1", { type: "denied", denyMessage: "not that file" });

		expect(await waiting).toEqual({ type: "denied", denyMessage: "not that file" });
	});

	it("refuses a call that is not waiting, so a stale decision is never silently dropped", () => {
		expect(() => rule("call-2", { type: "allowed" })).toThrow("No call call-2 is waiting");
	});

	it("refuses a second decision on the same call", async () => {
		const waiting = awaitRuling("call-3", "turn-1");
		rule("call-3", { type: "allowed" });
		await waiting;

		expect(() => rule("call-3", { type: "allowed" })).toThrow();
	});

	it("cancels what its own turn left pending, and nothing of another turn", async () => {
		const mine = awaitRuling("call-4", "turn-2");
		const other = awaitRuling("call-5", "turn-3");

		cancelRulings("turn-2");

		expect(await mine).toEqual({ type: "canceled" });
		rule("call-5", { type: "allowed" });
		expect(await other).toEqual({ type: "allowed" });
	});
});
