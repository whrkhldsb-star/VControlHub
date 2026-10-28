import { describe, expect, it } from "vitest";

import { modelsForEditing, parseStoredModels } from "../provider-models";

describe("provider model lists", () => {
	it("reads the JSON array the server stores, so an edit saves it back unchanged", () => {
		expect(modelsForEditing('["gpt-4o","gpt-4o-mini"]')).toBe("gpt-4o,gpt-4o-mini");
		// Three round trips used to give ["[\\"gpt-4o\\"", ...] and growing.
		let stored = '["gpt-4o","gpt-4o-mini"]';
		for (let i = 0; i < 3; i += 1) stored = JSON.stringify(parseStoredModels(modelsForEditing(stored)));
		expect(stored).toBe('["gpt-4o","gpt-4o-mini"]');
	});

	it("still reads a comma list, and repairs a list earlier edits had wrapped in quotes and brackets", () => {
		expect(parseStoredModels("gpt-4o-mini, gpt-4o")).toEqual(["gpt-4o-mini", "gpt-4o"]);
		expect(parseStoredModels('["gpt-4o","gpt-4o-mini"]'.replace(/^\[|\]$/g, ""))).toEqual(["gpt-4o", "gpt-4o-mini"]);
		expect(parseStoredModels(JSON.stringify(['["gpt-4o"', '"gpt-4o-mini"]']))).toEqual(["gpt-4o", "gpt-4o-mini"]);
		expect(parseStoredModels("")).toEqual([]);
		expect(parseStoredModels("a,a, ,b")).toEqual(["a", "b"]);
	});
});
