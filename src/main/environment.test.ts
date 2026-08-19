import { describe, expect, it } from "vitest";
import { pathFrom } from "./environment";

describe("pathFrom", () => {
	it("takes the path out from between the markers", () => {
		expect(pathFrom("__agentos_path__/usr/bin:/opt/node/bin__agentos_path__")).toBe("/usr/bin:/opt/node/bin");
	});

	it("ignores whatever a profile printed around it", () => {
		const said = "Welcome back!\nnvm loaded\n__agentos_path__/a:/b__agentos_path__";

		expect(pathFrom(said)).toBe("/a:/b");
	});

	it("finds nothing when the shell said nothing useful", () => {
		expect(pathFrom("command not found")).toBeUndefined();
		expect(pathFrom("__agentos_path__   __agentos_path__")).toBeUndefined();
	});
});
