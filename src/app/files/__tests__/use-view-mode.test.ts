import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useViewMode, VIEW_MODE_KEY, type ViewMode } from "../use-view-mode";

describe("useViewMode", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		localStorage.clear();
	});

	it("defaults to 'list' when nothing is persisted", () => {
		const { result } = renderHook(() => useViewMode());
		expect(result.current[0]).toBe("list");
	});

	it("reads a valid persisted mode from localStorage", () => {
		localStorage.setItem(VIEW_MODE_KEY, "grid");
		const { result } = renderHook(() => useViewMode());
		expect(result.current[0]).toBe("grid");
	});

	it("falls back to default for invalid persisted values", () => {
		localStorage.setItem(VIEW_MODE_KEY, "bogus" as ViewMode);
		const { result } = renderHook(() => useViewMode());
		expect(result.current[0]).toBe("list");
	});

	it("setter updates both state and localStorage", () => {
		const { result } = renderHook(() => useViewMode());
		act(() => result.current[1]("details"));
		expect(result.current[0]).toBe("details");
		expect(localStorage.getItem(VIEW_MODE_KEY)).toBe("details");
	});

	it("setter is stable across renders", () => {
		const { result, rerender } = renderHook(() => useViewMode());
		const firstSetter = result.current[1];
		act(() => result.current[1]("grid"));
		rerender();
		expect(result.current[1]).toBe(firstSetter);
	});

	it("survives a remount with the new value persisted", () => {
		const first = renderHook(() => useViewMode());
		act(() => first.result.current[1]("grid"));
		first.unmount();
		const second = renderHook(() => useViewMode());
		expect(second.result.current[0]).toBe("grid");
	});
});
