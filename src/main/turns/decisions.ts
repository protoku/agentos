export interface Decision {
	allowed: boolean;
	denyMessage?: string;
}

/** A pending call is not in the thread file yet, so the waiting turn is the only record of it. */
const waiting = new Map<string, (decision: Decision) => void>();

export function awaitDecision(callId: string): Promise<Decision> {
	return new Promise((resolve) => waiting.set(callId, resolve));
}

export function decide(callId: string, decision: Decision): void {
	const resolve = waiting.get(callId);
	if (resolve === undefined) throw new Error(`No call ${callId} is waiting for a decision`);

	waiting.delete(callId);
	resolve(decision);
}
