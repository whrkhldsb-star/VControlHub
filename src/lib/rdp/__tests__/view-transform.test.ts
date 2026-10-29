import { describe, expect, it } from "vitest";

import { clampView, fittedView, MAX_ZOOM, panBy, revealPoint, viewTransform, zoomAround } from "../view-transform";

const content = { width: 400, height: 300 };
const viewport = { width: 400, height: 300 };

describe("view transform", () => {
	it("centres a picture that fits and refuses to move it", () => {
		expect(fittedView({ width: 200, height: 100 }, viewport)).toEqual({ zoom: 1, x: 100, y: 100 });
		expect(panBy({ zoom: 1, x: 100, y: 100 }, 50, -50, { width: 200, height: 100 }, viewport)).toEqual({ zoom: 1, x: 100, y: 100 });
	});

	it("zooms around the point under the fingers, which stays where it is", () => {
		const view = zoomAround(fittedView(content, viewport), 2, 300, 150, content, viewport);
		expect(view.zoom).toBe(2);
		// The content point that was under (300,150) is still under it.
		expect((300 - view.x) / view.zoom).toBeCloseTo(300, 5);
		expect((150 - view.y) / view.zoom).toBeCloseTo(150, 5);
	});

	it("keeps the edges of a zoomed picture on or beyond the viewport's, never inside", () => {
		const zoomed = zoomAround(fittedView(content, viewport), 2, 0, 0, content, viewport);
		expect(zoomed.x).toBe(0);
		const far = panBy(zoomed, 900, 900, content, viewport);
		expect(far).toMatchObject({ x: 0, y: 0 });
		const other = panBy(zoomed, -900, -900, content, viewport);
		expect(other).toMatchObject({ x: -400, y: -300 });
	});

	it("limits the zoom and snaps a near-1 zoom back to the fitted picture", () => {
		expect(zoomAround(fittedView(content, viewport), 100, 0, 0, content, viewport).zoom).toBe(MAX_ZOOM);
		expect(zoomAround(fittedView(content, viewport), 0.1, 0, 0, content, viewport).zoom).toBe(1);
		expect(clampView({ zoom: 1.03, x: -5, y: -5 }, content, viewport)).toEqual({ zoom: 1, x: 0, y: 0 });
	});

	it("lets a picture taller than the visible part be moved up to the edge of that part (keyboard open)", () => {
		const visible = { width: 400, height: 140 };
		const view = fittedView(content, visible);
		expect(view).toEqual({ zoom: 1, x: 0, y: 0 });
		expect(panBy(view, 0, -500, content, visible).y).toBe(-160);
		expect(panBy(view, 0, 500, content, visible).y).toBe(0);
	});

	it("pans just far enough to bring a point inside the margin", () => {
		const zoomed = zoomAround(fittedView(content, viewport), 2, 0, 0, content, viewport);
		// Content point (390, 10) is at screen (780, 20): the picture moves left by 380 (to the limit -400) to show it.
		const view = revealPoint(zoomed, 390, 10, 24, content, viewport);
		expect(view.x).toBe(-400);
		expect(view.y).toBe(0);
		// A point already inside leaves the view alone.
		expect(revealPoint(zoomed, 100, 100, 24, content, viewport)).toBe(zoomed);
	});

	it("brings the pointer above the keyboard: the part under it is panned into the visible area", () => {
		const visible = { width: 400, height: 140 };
		const view = fittedView(content, visible);
		const shown = revealPoint(view, 200, 250, 20, content, visible);
		// Just far enough: the pointer ends 20 pixels above the keyboard's edge, not at the end of the picture.
		expect(shown.y).toBe(-130);
		expect(shown.y + 250 * shown.zoom).toBe(140 - 20);
	});

	it("draws nothing extra for the plain fitted picture", () => {
		expect(viewTransform({ zoom: 1, x: 100, y: 50 }, 100, 50)).toBe("");
		expect(viewTransform({ zoom: 2, x: -30, y: -10 }, 0, 0)).toBe("translate(-30.00px, -10.00px) scale(2.0000)");
	});
});
