import { describe, expect, it } from "vitest";

import { mediaHref, toggleFavoriteHref, toggleTagHref, toggleTypeHref } from "../media-filter-links";

describe("media filter links", () => {
	it("toggles selected tag off while preserving sibling filters", () => {
		expect(toggleTagHref({ type: "image", favorite: true, q: "cat", tag: "demo" }, "demo")).toBe(
			"/media?type=image&favorite=1&q=cat",
		);
	});

	it("toggles a different tag on while preserving type, favorite and search", () => {
		expect(toggleTagHref({ type: "video", favorite: true, q: "movie", tag: "demo" }, "travel")).toBe(
			"/media?type=video&favorite=1&q=movie&tag=travel",
		);
	});

	it("toggles selected type and favorites off", () => {
		expect(toggleTypeHref({ type: "audio", tag: "music" }, "audio")).toBe("/media?tag=music");
		expect(toggleFavoriteHref({ favorite: true, tag: "demo" })).toBe("/media?tag=demo");
	});

	it("builds URLs with encoded tag and search values", () => {
		expect(mediaHref({ tag: "旅行 2026", q: "猫 图" })).toBe("/media?q=%E7%8C%AB+%E5%9B%BE&tag=%E6%97%85%E8%A1%8C+2026");
	});
});
