export type Ruling = { type: "allowed" } | { type: "denied"; denyMessage?: string } | { type: "canceled" };

/** A pending call is not in the thread file yet, so the waiting turn is the only record of it. */
const waiting = new Map<string, { turnId: string; resolve: (ruling: Ruling) => void }>();

export function awaitRuling(callId: string, turnId: string): Promise<Ruling> {
	return new Promise((resolve) => waiting.set(callId, { turnId, resolve }));
}

export function rule(callId: string, ruling: Ruling): void {
	const pending = waiting.get(callId);
	if (pending === undefined) throw new Error(`No call ${callId} is waiting for a decision`);

	waiting.delete(callId);
	pending.resolve(ruling);
}

/** Once a call is settled it is nobody's to rule on, so the turn stops listening for one. */
export function forget(callId: string): void {
	waiting.delete(callId);
}

/** Canceling one call is not a decision either, and a call that just settled is simply gone. */
export function cancelRuling(callId: string): void {
	const pending = waiting.get(callId);
	if (pending === undefined) return;

	waiting.delete(callId);
	pending.resolve({ type: "canceled" });
}

/** Canceling a turn cancels what it left pending; the user never ruled, so this is no decision. */
export function cancelRulings(turnId: string): void {
	for (const [callId, pending] of waiting) {
		if (pending.turnId !== turnId) continue;

		waiting.delete(callId);
		pending.resolve({ type: "canceled" });
	}
}
