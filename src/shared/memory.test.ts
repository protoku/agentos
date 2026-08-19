import { describe, expect, it } from "vitest";
import { asTags, carriedMemories, matchMemories, memoryBlock } from "./memory";
import type { Memory } from "./types";

function memory(title: string, body: string, tags: string[], updatedAt: string): Memory {
	return { id: `id-${title}`, title, body, tags, createdAt: "2026-08-01T10:00:00.000Z", updatedAt };
}

const deploys = memory(
	"Deploy process",
	"Blue-green through scripts/deploy.",
	["deploy", "ops"],
	"2026-08-02T10:00:00.000Z",
);
const tokens = memory("Staging tokens", "They live in Env, never in a tool.", ["ops"], "2026-08-03T10:00:00.000Z");
const review = memory("Review rules", "Two approvals, and the pipeline green.", [], "2026-08-01T10:00:00.000Z");

const pool = [deploys, tokens, review];

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

describe("matchMemories", () => {
	it("finds a word wherever a memory says it", () => {
		expect(matchMemories(pool, { query: "green" })).toEqual([deploys, review]);
		expect(matchMemories(pool, { query: "env" })).toEqual([tokens]);
		expect(matchMemories(pool, { query: "deploy" })).toEqual([deploys]);
	});

	it("ignores case on both sides", () => {
		expect(matchMemories(pool, { query: "BLUE-GREEN" })).toEqual([deploys]);
	});

	it("wants every word, not any of them", () => {
		expect(matchMemories(pool, { query: "blue-green scripts" })).toEqual([deploys]);
		expect(matchMemories(pool, { query: "blue-green approvals" })).toEqual([]);
	});

	it("narrows by tags, and wants all of them", () => {
		expect(matchMemories(pool, { tags: ["ops"] })).toEqual([tokens, deploys]);
		expect(matchMemories(pool, { tags: ["ops", "deploy"] })).toEqual([deploys]);
		expect(matchMemories(pool, { query: "env", tags: ["deploy"] })).toEqual([]);
	});

	it("hands back everything, newest change first, when nothing is asked", () => {
		expect(matchMemories(pool, {})).toEqual([tokens, deploys, review]);
	});

	it("puts a title hit above a body hit, whatever changed last", () => {
		const mentions = memory("Env keys", "Staging tokens go here.", [], "2026-08-09T10:00:00.000Z");

		expect(matchMemories([mentions, tokens], { query: "tokens" })).toEqual([tokens, mentions]);
	});
});

describe("carriedMemories", () => {
	it("takes every memory under any tag the agent carries, newest change first", () => {
		expect(carriedMemories(pool, ["ops"])).toEqual([tokens, deploys]);
		expect(carriedMemories(pool, ["deploy"])).toEqual([deploys]);
	});

	it("carries nothing for an agent that names no tags", () => {
		expect(carriedMemories(pool, [])).toEqual([]);
	});
});

describe("memoryBlock", () => {
	it("gives an agent that carries nothing nothing at all", () => {
		expect(memoryBlock([])).toBe("");
	});

	it("prints each memory with its id and tags, in title order", () => {
		const written = memoryBlock(carriedMemories(pool, ["ops"]));

		expect(written).toContain("### Deploy process");
		expect(written).toContain("Id: id-Deploy process");
		expect(written).toContain("Tags: deploy, ops");
		expect(written.indexOf("Deploy process")).toBeLessThan(written.indexOf("Staging tokens"));
	});

	it("leaves out the tag line for a memory filed under nothing", () => {
		expect(memoryBlock([review])).not.toContain("Tags:");
	});

	it("keeps the twenty most recently changed and says how many there were", () => {
		const many = Array.from({ length: 22 }, (_, index) =>
			memory(`Memory ${index}`, "Something.", ["ops"], `2026-08-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`),
		);

		const written = memoryBlock(carriedMemories(many, ["ops"]));

		expect(written).toContain("20 of 22 memories, the most recently changed. Search for the rest.");
		expect(written).not.toContain("### Memory 0");
		expect(written).toContain("### Memory 21");
	});
});
