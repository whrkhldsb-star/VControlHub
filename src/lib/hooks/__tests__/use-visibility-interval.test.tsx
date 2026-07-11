import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVisibilityInterval } from "../use-visibility-interval";

describe("useVisibilityInterval", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("pauses in hidden tabs and catches up when visible again", () => {
		const callback = vi.fn();
		let visibilityState: DocumentVisibilityState = "visible";
		vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibilityState);

		renderHook(() => useVisibilityInterval(callback, 1000));
		act(() => vi.advanceTimersByTime(1000));
		expect(callback).toHaveBeenCalledTimes(1);

		visibilityState = "hidden";
		act(() => document.dispatchEvent(new Event("visibilitychange")));
		act(() => vi.advanceTimersByTime(3000));
		expect(callback).toHaveBeenCalledTimes(1);

		visibilityState = "visible";
		act(() => document.dispatchEvent(new Event("visibilitychange")));
		expect(callback).toHaveBeenCalledTimes(2);
		act(() => vi.advanceTimersByTime(1000));
		expect(callback).toHaveBeenCalledTimes(3);
	});
});
