export interface SlashCommand {
	toolId: string;
	input: Record<string, string>;
}

/** Not a tool: it asks an agent to write the summary later turns start from. */
export const summarizeCommand = "summarize";

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

/** What a /summarize asks for, the agent to write it and what to keep, or nothing if it is not one. */
export function parseSummarize(content: string): string | undefined {
	const match = /^\/summarize(?:\s+([\s\S]*))?$/.exec(content.trim());

	return match === null ? undefined : (match[1] ?? "").trim();
}
