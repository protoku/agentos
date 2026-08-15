import { describe, expect, it } from "vitest";
import { parseSlashCommand } from "./slash";

describe("parseSlashCommand", () => {
	it("leaves an ordinary message alone", () => {
		expect(parseSlashCommand("write the file for me")).toBeUndefined();
	});

	it("reads the tool and its arguments", () => {
		expect(parseSlashCommand("/write_file path=notes/todo.md content=Ship")).toEqual({
			toolId: "write_file",
			input: { path: "notes/todo.md", content: "Ship" },
		});
	});

	it("keeps a quoted value whole", () => {
		expect(parseSlashCommand('/write_file path=a.txt content="Ship it today"')).toEqual({
			toolId: "write_file",
			input: { path: "a.txt", content: "Ship it today" },
		});
	});

	it("unescapes a quote inside a quoted value", () => {
		expect(parseSlashCommand('/write_file path=a.txt content="say \\"hi\\""')?.input.content).toBe('say "hi"');
	});

	it("accepts a tool with no arguments", () => {
		expect(parseSlashCommand("/list_files")).toEqual({ toolId: "list_files", input: {} });
	});
});
