/** The models an agent can be pointed at. The record stores the id, so this list can grow freely. */
export const models = [
	{ id: "claude-opus-5", name: "Claude Opus 5" },
	{ id: "claude-sonnet-5", name: "Claude Sonnet 5" },
	{ id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
];

export const defaultModel = models[0].id;
