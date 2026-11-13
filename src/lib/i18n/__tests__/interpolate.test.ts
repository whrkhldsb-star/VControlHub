import { describe, expect, it } from "vitest";

import { interpolate } from "../core";

describe("interpolate", () => {
	it("fills placeholders", () => {
		expect(interpolate("{count} 个文件，共 {size}", { count: 3, size: "2 MB" })).toBe("3 个文件，共 2 MB");
		expect(interpolate("no vars {count}")).toBe("no vars {count}");
	});

	// English counts read "1 items" when a sentence has one form for every number.
	it("chooses the singular form for 1 and the plural one otherwise", () => {
		const text = "{count} {count|item|items} in {folders} {folders|folder|folders}";
		expect(interpolate(text, { count: 1, folders: 2 })).toBe("1 item in 2 folders");
		expect(interpolate(text, { count: 0, folders: 1 })).toBe("0 items in 1 folder");
		expect(interpolate("{count} {count|account still uses|accounts still use} it", { count: "1" })).toBe("1 account still uses it");
		expect(interpolate("{count} {count|day|days} ago", { count: "1,024" })).toBe("1,024 days ago");
	});

	it("leaves a form alone when its number is not given", () => {
		expect(interpolate("{count|item|items} of {total}", { total: 4 })).toBe("{count|item|items} of 4");
	});
});
