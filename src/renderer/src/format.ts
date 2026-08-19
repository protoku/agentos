/** A count read at a glance: thousands and millions shortened, small numbers left alone. */
export function thousands(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}m`;

	return count < 1000 ? `${count}` : `${(count / 1000).toFixed(1)}k`;
}
