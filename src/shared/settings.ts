/**
 * What a workspace decides for itself: env keys AgentOS reads rather than hands to a tool, which is
 * why they are described here and shown in the pane instead of living only in the doc.
 */
export interface Setting {
	key: string;
	decides: string;
	fallback: number;
}

export const settings: Setting[] = [
	{
		key: "WORKSPACE_MEMORY_LIMIT",
		decides: "How long a memory body may be, in characters",
		fallback: 2000,
	},
];

export const memoryLimit = settings[0];

/** Anything but a positive whole number leaves the default in force, rather than failing the work. */
export function settingIn(env: Record<string, string>, setting: Setting): number {
	const written = Number(env[setting.key]);

	return Number.isSafeInteger(written) && written > 0 ? written : setting.fallback;
}
