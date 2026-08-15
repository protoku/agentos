export interface SlashCommand {
	toolId: string;
	input: Record<string, string>;
}

const argument = /(\w+)=(?:"((?:[^"\\]|\\.)*)"|(\S+))/g;

/** A message starting with / is a tool call: /write_file path=notes.md content="Ship it" */
export function parseSlashCommand(content: string): SlashCommand | undefined {
	const trimmed = content.trim();
	if (!trimmed.startsWith("/")) return undefined;

	const [command, ...rest] = trimmed.slice(1).split(/\s+/);
	if (command.length === 0) return undefined;

	const input: Record<string, string> = {};
	for (const [, key, quoted, bare] of rest.join(" ").matchAll(argument)) {
		input[key] = quoted === undefined ? bare : quoted.replace(/\\(.)/g, "$1");
	}

	return { toolId: command, input };
}
