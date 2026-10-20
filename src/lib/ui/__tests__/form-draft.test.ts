import { describe, expect, it } from "vitest";

import { clearIfUnchanged } from "../form-draft";

describe("clearIfUnchanged", () => {
	it("clears a field still holding the saved value and keeps a newer draft", () => {
		let value = "saved";
		const set = (next: string | ((current: string) => string)) => { value = typeof next === "function" ? next(value) : next; };
		clearIfUnchanged(set, "saved", "");
		expect(value).toBe("");
		value = "next draft";
		clearIfUnchanged(set, "saved", "");
		expect(value).toBe("next draft");
	});
});
