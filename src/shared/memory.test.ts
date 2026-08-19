import { describe, expect, it } from "vitest";
import { asTags } from "./memory";

describe("asTags", () => {
	it("lowercases and trims, since a tag is matched exactly", () => {
		expect(asTags([" Ops ", "DEPLOY"])).toEqual(["ops", "deploy"]);
	});

	it("drops what is empty and what repeats", () => {
		expect(asTags(["ops", "", "  ", "ops", "OPS"])).toEqual(["ops"]);
	});

	it("keeps digits, hyphens and underscores", () => {
		expect(asTags(["gitlab-ci", "step_2", "v2"])).toEqual(["gitlab-ci", "step_2", "v2"]);
	});

	it("refuses a tag that is prose rather than a name", () => {
		expect(() => asTags(["deploy process"])).toThrow(
			"deploy process is not a tag: use letters, digits, hyphens and underscores",
		);
		expect(() => asTags(["-leading"])).toThrow("-leading is not a tag");
	});
});
