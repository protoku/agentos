import { describe, expect, it } from "vitest";
import { builtinToolMetadata } from "./builtin";

describe("builtinToolMetadata", () => {
	it("derives the input schema from the tool's input, descriptions included", () => {
		const write = builtinToolMetadata().find((tool) => tool.id === "write_file");

		expect(write?.inputSchema).toMatchObject({
			type: "object",
			properties: {
				path: { type: "string", description: "Path relative to the sandbox" },
				content: { type: "string" },
			},
			required: ["path", "content"],
		});
	});

	it("declares how a field reads, on both sides of a tool", () => {
		const read = builtinToolMetadata().find((tool) => tool.id === "read_file");
		const search = builtinToolMetadata().find((tool) => tool.id === "search_files");

		expect(read?.inputSchema).toMatchObject({ properties: { path: { render: "path" } } });
		expect(read?.outputSchema).toMatchObject({ properties: { content: { render: "text" } } });
		expect(search?.outputSchema).toMatchObject({ properties: { matches: { render: "table" } } });
	});

	it("leaves a defaulted argument out of required", () => {
		const list = builtinToolMetadata().find((tool) => tool.id === "list_files");

		expect(list?.inputSchema).not.toHaveProperty("required");
	});

	it("carries no functions, since IPC cannot", () => {
		expect(() => structuredClone(builtinToolMetadata())).not.toThrow();
	});
});
