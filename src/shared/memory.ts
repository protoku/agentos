/**
 * A tag is an identifier rather than prose: an agent carries a tag by matching it exactly, so
 * Deploy, deploy and deploy process would otherwise be three different places to file one thing.
 */
export function asTags(given: string[]): string[] {
	const tags = given.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0);

	for (const tag of tags) {
		if (!/^[a-z0-9][a-z0-9_-]*$/.test(tag)) {
			throw new Error(`${tag} is not a tag: use letters, digits, hyphens and underscores`);
		}
	}

	return [...new Set(tags)];
}
