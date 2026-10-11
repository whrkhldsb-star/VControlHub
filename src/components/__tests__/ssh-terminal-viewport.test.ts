import { describe, expect, it } from "vitest";

import { measureVisualViewport } from "../ssh-terminal-viewport";

describe("measureVisualViewport", () => {
	it("reports the area above an on-screen keyboard", () => {
		// An 844px phone with a 336px keyboard: the browser leaves the page at
		// 844 but shows only the top 508.
		expect(measureVisualViewport({ height: 508, offsetTop: 0, scale: 1 }, 844)).toEqual({ height: 508, offsetTop: 0 });
	});

	it("follows the visual viewport when the browser scrolled the page under it", () => {
		expect(measureVisualViewport({ height: 508.4, offsetTop: 120.2, scale: 1 }, 844)).toEqual({ height: 508, offsetTop: 120 });
	});

	it("keeps the layout height under pinch zoom, which hides nothing", () => {
		expect(measureVisualViewport({ height: 422, offsetTop: 200, scale: 2 }, 844)).toEqual({ height: 844, offsetTop: 0 });
	});
});
