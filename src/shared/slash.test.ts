import { describe, expect, it } from "vitest";
import { parseSlashCommand, parseSummarize } from "./slash";

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

describe("parseSummarize", () => {
	it("reads what follows /summarize as the request", () => {
		expect(parseSummarize("/summarize @dev keep\nthe chart conventions")).toBe("@dev keep\nthe chart conventions");
		expect(parseSummarize("/summarize")).toBe("");
	});

	it("leaves anything else alone, a tool whose name merely starts the same included", () => {
		expect(parseSummarize("summarize this")).toBeUndefined();
		expect(parseSummarize("/summarizer @dev")).toBeUndefined();
	});
});
