import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { RdpPanControl } from "../rdp-pan-control";

/** The knob of the pan control: pushed one way, the view runs the other way at a speed that follows the push, until let go. */
beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 76, bottom: 76, width: 76, height: 76, toJSON() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("moves the view against the push while held, and stops when let go", async () => {
  const onPan = vi.fn();
  render(<RdpPanControl label="pan" onPan={onPan} />);
  const control = screen.getByRole("button", { name: "pan" });
  // Pushed right and a little down from the middle (38, 38).
  fireEvent.pointerDown(control, { clientX: 62, clientY: 46, pointerId: 1 });
  await waitFor(() => expect(onPan).toHaveBeenCalled());
  const [dx, dy] = onPan.mock.calls.at(-1)!;
  expect(dx).toBeLessThan(0);
  expect(dy).toBeLessThan(0);
  expect(Math.abs(dx)).toBeGreaterThan(Math.abs(dy));

  fireEvent.pointerUp(control, { pointerId: 1 });
  const calls = onPan.mock.calls.length;
  await new Promise(resolve => setTimeout(resolve, 80));
  expect(onPan.mock.calls.length).toBe(calls);
});

it("does not move the view for a push inside the dead zone", async () => {
  const onPan = vi.fn();
  render(<RdpPanControl label="pan" onPan={onPan} />);
  fireEvent.pointerDown(screen.getByRole("button", { name: "pan" }), { clientX: 39, clientY: 38, pointerId: 1 });
  await new Promise(resolve => setTimeout(resolve, 80));
  expect(onPan).not.toHaveBeenCalled();
});
