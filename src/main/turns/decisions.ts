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

/** Canceling a turn cancels what it left pending; the user never ruled, so this is no decision. */
export function cancelRulings(turnId: string): void {
	for (const [callId, pending] of waiting) {
		if (pending.turnId !== turnId) continue;

		waiting.delete(callId);
		pending.resolve({ type: "canceled" });
	}
}
