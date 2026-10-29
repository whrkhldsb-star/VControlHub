import { describe, expect, it } from "vitest";

import { createTouchGestures, type GestureClock, type GestureOutput, type TouchMode, type TouchPoint } from "../touch-gestures";

/**
 * The finger gestures of Microsoft's Remote Desktop app, as the recogniser turns them into remote mouse actions.
 * A fake clock drives every timing rule, and nothing here touches the DOM.
 */
function harness(initialMode: TouchMode = "pointer") {
	let now = 1_000;
	let nextTimer = 1;
	const timers = new Map<number, { at: number; run: () => void }>();
	const clock: GestureClock = {
		now: () => now,
		setTimeout: (run, ms) => { const id = nextTimer++; timers.set(id, { at: now + ms, run }); return id; },
		clearTimeout: handle => { timers.delete(handle as number); },
	};
	const events: string[] = [];
	const round = (n: number) => Math.round(n * 100) / 100;
	const output: GestureOutput = {
		pointerMoveBy: (dx, dy) => events.push(`by ${round(dx)},${round(dy)}`),
		pointerMoveTo: (x, y) => events.push(`to ${round(x)},${round(y)}`),
		button: (which, pressed) => events.push(`${which} ${pressed ? "down" : "up"}`),
		wheel: notches => events.push(`wheel ${notches}`),
		zoomBy: (factor, x, y) => events.push(`zoom ${round(factor)} @${round(x)},${round(y)}`),
		panBy: (dx, dy) => events.push(`pan ${round(dx)},${round(dy)}`),
		holdRegistered: (x, y) => events.push(`hold ${round(x)},${round(y)}`),
	};
	let mode = initialMode;
	const gestures = createTouchGestures(output, () => mode, { clock });
	const wait = (ms: number) => {
		now += ms;
		for (const [id, timer] of [...timers]) {
			if (timer.at <= now) { timers.delete(id); timer.run(); }
		}
	};
	const point = (id: number, x: number, y: number): TouchPoint => ({ id, x, y });
	return {
		gestures,
		events,
		wait,
		point,
		setMode: (next: TouchMode) => { mode = next; },
		/** Returns and clears what has been emitted so far. */
		take: () => events.splice(0),
	};
}

describe("mouse pointer mode", () => {
	it("moves the pointer by the finger's travel, from where it came down, and clicks nothing", () => {
		const h = harness();
		h.gestures.start([h.point(1, 100, 100)]);
		// Within the slop nothing moves yet: a tap must not nudge the pointer.
		h.gestures.move([h.point(1, 104, 103)]);
		expect(h.take()).toEqual([]);
		h.gestures.move([h.point(1, 130, 100)]);
		h.gestures.move([h.point(1, 150, 120)]);
		h.gestures.end([]);
		expect(h.take()).toEqual(["by 30,0", "by 20,20"]);
	});

	it("taps with one finger to left-click where the pointer is", () => {
		const h = harness();
		h.gestures.start([h.point(1, 100, 100)]);
		h.wait(80);
		h.gestures.end([]);
		expect(h.take()).toEqual(["left down", "left up"]);
	});

	it("does nothing for a press that is neither a tap nor a hold", () => {
		const h = harness();
		h.gestures.start([h.point(1, 100, 100)]);
		h.wait(420);
		h.gestures.end([]);
		expect(h.take()).toEqual([]);
	});

	it("double-taps to double-click: the second touch presses at once and the lift releases", () => {
		const h = harness();
		h.gestures.start([h.point(1, 100, 100)]);
		h.wait(60);
		h.gestures.end([]);
		h.wait(120);
		h.gestures.start([h.point(1, 102, 100)]);
		h.wait(60);
		h.gestures.end([]);
		expect(h.take()).toEqual(["left down", "left up", "left down", "left up"]);
	});

	it("drags with a double-tap and hold, then drag (Android)", () => {
		const h = harness();
		h.gestures.start([h.point(1, 100, 100)]);
		h.wait(60);
		h.gestures.end([]);
		h.take();
		h.wait(100);
		h.gestures.start([h.point(1, 100, 100)]);
		h.gestures.move([h.point(1, 140, 100)]);
		h.gestures.move([h.point(1, 170, 130)]);
		h.gestures.end([]);
		expect(h.take()).toEqual(["left down", "by 40,0", "by 30,30", "left up"]);
	});

	it("lets a third quick tap through, for a triple click", () => {
		const h = harness();
		for (let i = 0; i < 3; i += 1) {
			h.gestures.start([h.point(1, 100, 100)]);
			h.wait(50);
			h.gestures.end([]);
			h.wait(100);
		}
		expect(h.take()).toEqual(["left down", "left up", "left down", "left up", "left down", "left up"]);
	});

	it("holds, then drags (iOS): the button goes down when the hold registers", () => {
		const h = harness();
		h.gestures.start([h.point(1, 100, 100)]);
		h.wait(499);
		expect(h.take()).toEqual([]);
		h.wait(2);
		expect(h.take()).toEqual(["hold 100,100", "left down"]);
		h.gestures.move([h.point(1, 150, 100)]);
		h.gestures.end([]);
		expect(h.take()).toEqual(["by 50,0", "left up"]);
	});

	it("releases a held press that never moved", () => {
		const h = harness();
		h.gestures.start([h.point(1, 100, 100)]);
		h.wait(600);
		h.gestures.end([]);
		expect(h.take()).toEqual(["hold 100,100", "left down", "left up"]);
	});

	it("taps with two fingers to right-click", () => {
		const h = harness();
		h.gestures.start([h.point(1, 100, 100), h.point(2, 160, 100)]);
		h.wait(90);
		h.gestures.end([h.point(2, 160, 100)]);
		h.gestures.end([]);
		expect(h.take()).toEqual(["right down", "right up"]);
	});

	it("counts a two-finger tap from the first finger even when the second lands a moment later", () => {
		const h = harness();
		h.gestures.start([h.point(1, 100, 100)]);
		h.wait(120);
		h.gestures.start([h.point(1, 100, 100), h.point(2, 160, 100)]);
		h.wait(80);
		h.gestures.end([]);
		expect(h.take()).toEqual(["right down", "right up"]);
	});

	it("does not right-click for two fingers that stay down too long", () => {
		const h = harness();
		h.gestures.start([h.point(1, 100, 100), h.point(2, 160, 100)]);
		h.wait(600);
		h.gestures.end([]);
		expect(h.take()).toEqual([]);
	});

	it("scrolls with two fingers: the content follows them, so dragging up scrolls down", () => {
		const h = harness();
		h.gestures.start([h.point(1, 100, 300), h.point(2, 160, 300)]);
		h.gestures.move([h.point(1, 100, 260), h.point(2, 160, 260)]);
		expect(h.take()).toEqual(["wheel 1"]);
		h.gestures.move([h.point(1, 100, 200), h.point(2, 160, 200)]);
		// 60 more pixels with 12 carried over: two more notches.
		expect(h.take()).toEqual(["wheel 2"]);
		// Back down 60 pixels against the 16 left over: 44 pixels, one notch the other way.
		h.gestures.move([h.point(1, 100, 260), h.point(2, 160, 260)]);
		expect(h.take()).toEqual(["wheel -1"]);
		h.gestures.end([h.point(2, 160, 260)]);
		h.gestures.end([]);
		// A scroll is not a tap.
		expect(h.take()).toEqual([]);
	});

	it("pinches to zoom around the fingers' centre, without scrolling", () => {
		const h = harness();
		h.gestures.start([h.point(1, 100, 300), h.point(2, 200, 300)]);
		h.gestures.move([h.point(1, 80, 300), h.point(2, 220, 300)]);
		const events = h.take();
		expect(events).toContain("zoom 1.4 @150,300");
		expect(events.some(event => event.startsWith("wheel"))).toBe(false);
		h.gestures.move([h.point(1, 100, 300), h.point(2, 200, 300)]);
		expect(h.take()).toContain("zoom 0.71 @150,300");
	});

	it("lets the fingers' centre carry the view along while pinching", () => {
		const h = harness();
		h.gestures.start([h.point(1, 100, 300), h.point(2, 200, 300)]);
		h.gestures.move([h.point(1, 80, 300), h.point(2, 220, 300)]);
		h.take();
		h.gestures.move([h.point(1, 90, 320), h.point(2, 230, 320)]);
		expect(h.take()).toContain("pan 10,20");
	});

	it("right-drags with a two-finger tap followed at once by two fingers held and dragged", () => {
		const h = harness();
		h.gestures.start([h.point(1, 100, 100), h.point(2, 160, 100)]);
		h.wait(70);
		h.gestures.end([h.point(2, 160, 100)]);
		h.gestures.end([]);
		h.take();
		h.wait(120);
		h.gestures.start([h.point(1, 100, 100), h.point(2, 160, 100)]);
		h.gestures.move([h.point(1, 140, 100), h.point(2, 200, 100)]);
		h.gestures.end([h.point(2, 200, 100)]);
		h.gestures.end([]);
		expect(h.take()).toEqual(["right down", "by 40,0", "right up"]);
	});

	it("does not turn the finger left on the screen into a drag after a two-finger gesture", () => {
		const h = harness();
		h.gestures.start([h.point(1, 100, 300), h.point(2, 160, 300)]);
		h.gestures.move([h.point(1, 100, 250), h.point(2, 160, 250)]);
		h.take();
		h.gestures.end([h.point(2, 160, 250)]);
		h.gestures.move([h.point(2, 200, 250)]);
		h.gestures.move([h.point(2, 260, 250)]);
		h.wait(900);
		h.gestures.end([]);
		expect(h.take()).toEqual([]);
	});

	it("ignores three fingers", () => {
		const h = harness();
		h.gestures.start([h.point(1, 50, 100)]);
		h.gestures.start([h.point(1, 50, 100), h.point(2, 150, 100)]);
		h.gestures.start([h.point(1, 50, 100), h.point(2, 150, 100), h.point(3, 250, 100)]);
		h.gestures.move([h.point(1, 50, 160), h.point(2, 150, 160), h.point(3, 250, 160)]);
		h.gestures.end([h.point(1, 50, 160), h.point(2, 150, 160)]);
		h.gestures.end([]);
		expect(h.take()).toEqual([]);
	});

	it("releases a held button when the touch is cancelled, and starts clean after a lost end", () => {
		const h = harness();
		h.gestures.start([h.point(1, 100, 100)]);
		h.wait(600);
		h.take();
		h.gestures.cancel();
		expect(h.take()).toEqual(["left up"]);
		// A touch whose end was never delivered: the next first touch starts afresh.
		h.gestures.start([h.point(1, 100, 100)]);
		h.gestures.move([h.point(1, 160, 100)]);
		h.take();
		h.gestures.start([h.point(7, 20, 20)]);
		h.wait(60);
		h.gestures.end([]);
		expect(h.take()).toEqual(["left down", "left up"]);
	});

	it("ends a left drag when a second finger joins, instead of leaving the button down", () => {
		const h = harness();
		h.gestures.start([h.point(1, 100, 100)]);
		h.wait(600);
		h.take();
		h.gestures.start([h.point(1, 100, 100), h.point(2, 200, 100)]);
		expect(h.take()).toEqual(["left up"]);
	});
});

describe("direct touch mode", () => {
	it("taps to left-click where the finger is", () => {
		const h = harness("direct");
		h.gestures.start([h.point(1, 120, 340)]);
		h.wait(70);
		h.gestures.end([]);
		expect(h.take()).toEqual(["to 120,340", "to 120,340", "left down", "left up"]);
	});

	it("holds and releases to right-click where the finger is", () => {
		const h = harness("direct");
		h.gestures.start([h.point(1, 120, 340)]);
		h.wait(520);
		expect(h.take()).toEqual(["to 120,340", "hold 120,340"]);
		h.gestures.end([]);
		expect(h.take()).toEqual(["to 120,340", "right down", "right up"]);
	});

	it("drags with the left button from where the finger came down", () => {
		const h = harness("direct");
		h.gestures.start([h.point(1, 100, 100)]);
		h.gestures.move([h.point(1, 130, 100)]);
		h.gestures.move([h.point(1, 200, 160)]);
		h.gestures.end([]);
		expect(h.take()).toEqual(["to 100,100", "to 100,100", "left down", "to 130,100", "to 200,160", "left up"]);
	});

	it("drags from a hold too, rather than right-clicking", () => {
		const h = harness("direct");
		h.gestures.start([h.point(1, 100, 100)]);
		h.wait(600);
		h.take();
		h.gestures.move([h.point(1, 160, 100)]);
		h.gestures.end([]);
		expect(h.take()).toEqual(["to 100,100", "left down", "to 160,100", "left up"]);
	});

	it("scrolls and pinches with two fingers, which a mouse cannot do natively", () => {
		const h = harness("direct");
		h.gestures.start([h.point(1, 100, 300), h.point(2, 160, 300)]);
		h.gestures.move([h.point(1, 100, 250), h.point(2, 160, 250)]);
		expect(h.take()).toEqual(["wheel 1"]);
		h.gestures.end([h.point(2, 160, 250)]);
		h.gestures.end([]);
		h.wait(500);
		h.gestures.start([h.point(1, 100, 300), h.point(2, 200, 300)]);
		h.gestures.move([h.point(1, 70, 300), h.point(2, 230, 300)]);
		expect(h.take().some(event => event.startsWith("zoom"))).toBe(true);
	});

	it("right-clicks for a two-finger tap, at the centre of the fingers", () => {
		const h = harness("direct");
		h.gestures.start([h.point(1, 100, 100), h.point(2, 160, 140)]);
		h.wait(80);
		h.gestures.end([h.point(2, 160, 140)]);
		h.gestures.end([]);
		expect(h.take()).toEqual(["to 130,120", "right down", "right up"]);
	});

	it("follows a mode change between touches", () => {
		const h = harness("pointer");
		h.gestures.start([h.point(1, 100, 100)]);
		h.wait(70);
		h.gestures.end([]);
		expect(h.take()).toEqual(["left down", "left up"]);
		h.setMode("direct");
		h.wait(1_000);
		h.gestures.start([h.point(1, 100, 100)]);
		h.wait(70);
		h.gestures.end([]);
		expect(h.take()).toEqual(["to 100,100", "to 100,100", "left down", "left up"]);
	});
});
