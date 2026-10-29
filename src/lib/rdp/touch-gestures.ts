/**
 * Finger gestures for a remote desktop on a phone or tablet, modelled on
 * Microsoft's Remote Desktop app (Android and iOS), whose documented gestures
 * are:
 *
 * Mouse pointer (a visible pointer that the finger moves like a touchpad):
 *   - drag with one finger          move the pointer
 *   - tap with one finger           left click, where the pointer is
 *   - double-tap, hold, drag        left drag (Android); tap-and-hold, drag (iOS)
 *   - tap with two fingers          right click
 *   - double-tap with two fingers, hold, drag   right drag
 *   - drag with two fingers         mouse wheel
 *   - pinch                         zoom
 *
 * Direct touch (no pointer; the finger is the pointer):
 *   - tap                           left click, where the finger is
 *   - tap and hold, release         right click
 *   - drag                          left drag (the app passes real touch input on; this
 *                                   browser client has only a mouse to offer)
 *
 * Two fingers also scroll and pinch in direct touch, which a real touch screen does
 * natively and a mouse cannot.
 *
 * The recogniser knows nothing about the DOM or Guacamole: it is fed the fingers
 * that are down and says what the remote mouse should do, so every rule can be
 * tested with a fake clock.
 */

export type TouchPoint = { id: number; x: number; y: number };
export type TouchMode = "pointer" | "direct";

export type GestureOutput = {
  /** Pointer mode: the pointer moved by the finger's travel, in screen pixels. */
  pointerMoveBy(dx: number, dy: number): void;
  /** Direct touch: the pointer goes to a place on the screen, in screen pixels. */
  pointerMoveTo(x: number, y: number): void;
  button(which: "left" | "right", pressed: boolean): void;
  /** Wheel notches; positive scrolls the content down. */
  wheel(notches: number): void;
  /** Two fingers moved apart (>1) or together (<1) around a screen point. */
  zoomBy(factor: number, x: number, y: number): void;
  /** Two fingers pinching also carry the view along with their centre. */
  panBy(dx: number, dy: number): void;
  /** A hold registered: the app draws a ring and, where supported, buzzes. */
  holdRegistered(x: number, y: number): void;
};

export type GestureClock = {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type GestureTuning = {
  /** Travel that turns a touch into a drag, in pixels. */
  slop: number;
  /** A touch shorter than this is a tap. */
  tapMs: number;
  /** A second touch this soon after a tap continues it (double click, tap-and-drag). */
  doubleTapMs: number;
  /** A finger held still this long has pressed and held. */
  holdMs: number;
  /** Two fingers shorter than this, and still, are a two-finger tap. */
  twoFingerTapMs: number;
  /** Finger travel per mouse wheel notch. */
  wheelStep: number;
};

export const DEFAULT_TUNING: GestureTuning = {
  slop: 10,
  tapMs: 350,
  doubleTapMs: 300,
  holdMs: 500,
  twoFingerTapMs: 350,
  wheelStep: 28,
};

const systemClock: GestureClock = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

type One = {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startedAt: number;
  moved: boolean;
  /** The left button is down for this touch (tap-and-drag, hold, or a direct-touch drag). */
  leftDown: boolean;
  held: boolean;
  holdTimer: unknown;
};

type Two = {
  a: number;
  b: number;
  startedAt: number;
  startCx: number;
  startCy: number;
  startDist: number;
  lastCx: number;
  lastCy: number;
  lastDist: number;
  moved: boolean;
  mode: "undecided" | "scroll" | "pinch" | "rightDrag";
  wheelCarry: number;
  rightDown: boolean;
};

export type TouchGestures = {
  /** `touches` are all the fingers on the screen after the change. */
  start(touches: readonly TouchPoint[]): void;
  move(touches: readonly TouchPoint[]): void;
  end(touches: readonly TouchPoint[]): void;
  /** Releases anything held; the touch sequence was interrupted. */
  cancel(): void;
  dispose(): void;
};

export function createTouchGestures(
  output: GestureOutput,
  mode: () => TouchMode,
  options: { clock?: GestureClock; tuning?: Partial<GestureTuning> } = {},
): TouchGestures {
  const clock = options.clock ?? systemClock;
  const tune: GestureTuning = { ...DEFAULT_TUNING, ...options.tuning };

  let phase: "idle" | "one" | "two" | "ignore" = "idle";
  let one: One | null = null;
  let two: Two | null = null;
  /** When the last tap of one finger was released (for double click and tap-and-drag). */
  let lastTapAt = -Infinity;
  /** When the last tap of two fingers was released (for right drag). */
  let lastTwoTapAt = -Infinity;

  const find = (touches: readonly TouchPoint[], id: number) => touches.find(point => point.id === id);

  const releaseOne = () => {
    if (!one) return;
    clock.clearTimeout(one.holdTimer);
    if (one.leftDown) output.button("left", false);
    one = null;
  };

  const releaseTwo = () => {
    if (!two) return;
    if (two.rightDown) output.button("right", false);
    two = null;
  };

  const click = (which: "left" | "right") => {
    output.button(which, true);
    output.button(which, false);
  };

  // ── one finger ──────────────────────────────────────────────────────────

  const beginOne = (point: TouchPoint) => {
    const now = clock.now();
    const state: One = {
      id: point.id,
      startX: point.x,
      startY: point.y,
      lastX: point.x,
      lastY: point.y,
      startedAt: now,
      moved: false,
      leftDown: false,
      held: false,
      holdTimer: undefined,
    };
    one = state;
    phase = "one";
    if (mode() === "direct") {
      // The finger is the pointer: it hovers where it lands.
      output.pointerMoveTo(point.x, point.y);
    } else if (now - lastTapAt <= tune.doubleTapMs) {
      // Tap, then touch again at once: the second press is the button going down.
      // Lifted quickly it is the second click of a double click; dragged it is a
      // left drag (Android's "double-tap and hold, then drag").
      state.leftDown = true;
      output.button("left", true);
    }
    state.holdTimer = clock.setTimeout(() => {
      if (one !== state || state.moved || state.held) return;
      state.held = true;
      output.holdRegistered(state.lastX, state.lastY);
      // Pointer mode: pressed and held, then dragged, is a left drag (iOS). Direct
      // touch keeps the button up: released in place it is a right click.
      if (mode() === "pointer" && !state.leftDown) {
        state.leftDown = true;
        output.button("left", true);
      }
    }, tune.holdMs);
  };

  const moveOne = (touches: readonly TouchPoint[]) => {
    const state = one;
    if (!state) return;
    const point = find(touches, state.id);
    if (!point) return;
    if (!state.moved) {
      if (Math.hypot(point.x - state.startX, point.y - state.startY) <= tune.slop) {
        state.lastX = point.x;
        state.lastY = point.y;
        return;
      }
      state.moved = true;
      clock.clearTimeout(state.holdTimer);
      if (mode() === "direct" && !state.leftDown) {
        // A drag starts where the finger first touched down.
        output.pointerMoveTo(state.startX, state.startY);
        state.leftDown = true;
        output.button("left", true);
      }
      // Movement counts from where the finger came down, so the pointer does not jump.
      state.lastX = state.startX;
      state.lastY = state.startY;
    }
    if (mode() === "direct") output.pointerMoveTo(point.x, point.y);
    else output.pointerMoveBy(point.x - state.lastX, point.y - state.lastY);
    state.lastX = point.x;
    state.lastY = point.y;
  };

  const endOne = () => {
    const state = one;
    if (!state) return;
    const duration = clock.now() - state.startedAt;
    clock.clearTimeout(state.holdTimer);
    if (state.leftDown) {
      // A drag, a hold, or the second touch of a double click: the button comes up.
      output.button("left", false);
      state.leftDown = false;
      lastTapAt = !state.moved && duration <= tune.tapMs ? clock.now() : -Infinity;
    } else if (!state.moved && state.held && mode() === "direct") {
      // Tap and hold, then release: a right click where the finger is.
      output.pointerMoveTo(state.lastX, state.lastY);
      click("right");
      lastTapAt = -Infinity;
    } else if (!state.moved && duration <= tune.tapMs) {
      if (mode() === "direct") output.pointerMoveTo(state.lastX, state.lastY);
      click("left");
      lastTapAt = clock.now();
    } else {
      lastTapAt = -Infinity;
    }
    one = null;
  };

  // ── two fingers ─────────────────────────────────────────────────────────

  const centre = (a: TouchPoint, b: TouchPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  const beginTwo = (a: TouchPoint, b: TouchPoint, startedAt: number) => {
    const c = centre(a, b);
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    two = {
      a: a.id,
      b: b.id,
      startedAt,
      startCx: c.x,
      startCy: c.y,
      startDist: dist,
      lastCx: c.x,
      lastCy: c.y,
      lastDist: dist,
      moved: false,
      mode: "undecided",
      wheelCarry: 0,
      rightDown: false,
    };
    phase = "two";
    if (mode() === "pointer" && clock.now() - lastTwoTapAt <= tune.doubleTapMs) {
      // Two fingers again right after a two-finger tap: the right button goes down for a drag.
      two.mode = "rightDrag";
      two.rightDown = true;
      output.button("right", true);
    }
  };

  const moveTwo = (touches: readonly TouchPoint[]) => {
    const state = two;
    if (!state) return;
    const a = find(touches, state.a), b = find(touches, state.b);
    if (!a || !b) return;
    const c = centre(a, b);
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (!state.moved) {
      const travel = Math.hypot(c.x - state.startCx, c.y - state.startCy);
      const spread = Math.abs(dist - state.startDist);
      if (Math.max(travel, spread) <= tune.slop) return;
      state.moved = true;
      if (state.mode === "undecided") state.mode = spread > travel * 1.2 ? "pinch" : "scroll";
      // Counted from where the fingers came down, as for one finger.
      state.lastCx = state.startCx;
      state.lastCy = state.startCy;
      state.lastDist = state.startDist;
    }
    const dx = c.x - state.lastCx, dy = c.y - state.lastCy;
    if (state.mode === "scroll") {
      // The content follows the fingers: dragging up scrolls down.
      state.wheelCarry -= dy;
      const notches = Math.trunc(state.wheelCarry / tune.wheelStep);
      if (notches !== 0) {
        state.wheelCarry -= notches * tune.wheelStep;
        output.wheel(notches);
      }
    } else if (state.mode === "pinch") {
      if (state.lastDist > 0 && dist > 0) output.zoomBy(dist / state.lastDist, c.x, c.y);
      if (dx || dy) output.panBy(dx, dy);
    } else if (state.mode === "rightDrag") {
      output.pointerMoveBy(dx, dy);
    }
    state.lastCx = c.x;
    state.lastCy = c.y;
    state.lastDist = dist;
  };

  /** A finger of the pair came up. */
  const endTwo = () => {
    const state = two;
    if (!state) return;
    const duration = clock.now() - state.startedAt;
    if (state.rightDown) {
      output.button("right", false);
      state.rightDown = false;
      // A right drag that never moved is a second right click: keep a third one possible.
      lastTwoTapAt = state.moved ? -Infinity : clock.now();
    } else if (!state.moved && duration <= tune.twoFingerTapMs) {
      if (mode() === "direct") output.pointerMoveTo(state.lastCx, state.lastCy);
      click("right");
      lastTwoTapAt = clock.now();
    } else {
      lastTwoTapAt = -Infinity;
    }
    two = null;
    lastTapAt = -Infinity;
  };

  // ── entry points ────────────────────────────────────────────────────────

  const cancel = () => {
    releaseOne();
    releaseTwo();
    lastTapAt = -Infinity;
    lastTwoTapAt = -Infinity;
    phase = "idle";
  };

  return {
    start(touches) {
      if (touches.length === 0) return;
      // A single finger down while a gesture is still open: its end was never seen.
      if (touches.length === 1 && phase !== "idle") cancel();
      if (phase === "idle" && touches.length === 1) {
        beginOne(touches[0]!);
        return;
      }
      if (phase === "one" && touches.length === 2 && one) {
        // The second finger joined: a two-finger gesture, timed from the first one's touch.
        const startedAt = one.startedAt;
        const first = find(touches, one.id);
        const other = touches.find(point => point.id !== one!.id);
        // A drag already under way (button down) ends: two fingers mean something else.
        releaseOne();
        if (first && other) beginTwo(first, other, startedAt);
        else phase = "ignore";
        return;
      }
      if (phase === "idle" && touches.length === 2) {
        beginTwo(touches[0]!, touches[1]!, clock.now());
        return;
      }
      // Three fingers or a stray start: wait for everything to lift.
      releaseOne();
      releaseTwo();
      phase = "ignore";
    },

    move(touches) {
      if (phase === "one") moveOne(touches);
      else if (phase === "two") moveTwo(touches);
    },

    end(touches) {
      if (phase === "one") {
        if (touches.length === 0) {
          endOne();
          phase = "idle";
        }
        return;
      }
      if (phase === "two") {
        // The first finger up ends the gesture; the other must not turn into a drag.
        endTwo();
        phase = touches.length === 0 ? "idle" : "ignore";
        return;
      }
      if (phase === "ignore" && touches.length === 0) phase = "idle";
    },

    cancel,
    dispose: cancel,
  };
}
