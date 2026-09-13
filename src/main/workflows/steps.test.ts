import { describe, expect, it } from "vitest";
import { holds, resolve } from "./steps";

const results = {
	input: { request: "Add a health check", urgent: true },
	read: { what: "A health check", count: 3, tags: ["api", "ops"] },
};

describe("resolve", () => {
	it("keeps the type of a value that is nothing but a reference", () => {
		expect(resolve("{{ read.count }}", results)).toBe(3);
		expect(resolve("{{ read.tags }}", results)).toEqual(["api", "ops"]);
		expect(resolve("{{ read }}", results)).toEqual(results.read);
	});

	it("reads a reference inside a sentence as text", () => {
		expect(resolve("About {{ read.what }}, {{ read.count }} places", results)).toBe(
			"About A health check, 3 places",
		);
	});

	it("fills in everywhere a step's input holds a string", () => {
		expect(resolve({ summary: "{{ input.request }}", labels: ["{{ read.what }}"] }, results)).toEqual({
			summary: "Add a health check",
			labels: ["A health check"],
		});
	});

	it("says what is missing rather than filling in nothing", () => {
		expect(() => resolve("{{ gone.thing }}", results)).toThrow("Nothing here is called gone");
		expect(() => resolve("{{ read.nothing }}", results)).toThrow("read says nothing about nothing");
	});
});

describe("holds", () => {
	it("reads a condition as whether what came before amounts to anything", () => {
		expect(holds("{{ input.urgent }}", results)).toBe(true);
		expect(holds("{{ read.what }}", results)).toBe(true);
		expect(holds("{{ read.tags }}", results)).toBe(true);
		expect(holds("{{ read.count }}", results)).toBe(true);
	});

	it("reads nothing, an empty list and an empty line as no", () => {
		const empty = { step: { nothing: "", none: [], no: false, zero: 0 } };

		expect(holds("{{ step.nothing }}", empty)).toBe(false);
		expect(holds("{{ step.none }}", empty)).toBe(false);
		expect(holds("{{ step.no }}", empty)).toBe(false);
		expect(holds("{{ step.zero }}", empty)).toBe(false);
	});
});
