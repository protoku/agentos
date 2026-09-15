/** A count read at a glance: thousands and millions shortened, small numbers left alone. */
export function thousands(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}m`;

	return count < 1000 ? `${count}` : `${(count / 1000).toFixed(1)}k`;
}

/** Cents matter while a conversation is young, and stop mattering once it is not. */
export function money(usd: number): string {
	return `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
}
