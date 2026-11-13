import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";

import { useFileListSort } from "../use-file-list-sort";

describe("useFileListSort", () => {
	it("starts at name/asc by default", () => {
		const { result } = renderHook(() => useFileListSort());
		expect(result.current.sortKey).toBe("name");
		expect(result.current.sortDir).toBe("asc");
	});

	it("respects a custom initial state", () => {
		const { result } = renderHook(() => useFileListSort({ key: "size", dir: "desc" }));
		expect(result.current.sortKey).toBe("size");
		expect(result.current.sortDir).toBe("desc");
	});

	it("toggling the same column flips direction", () => {
		const { result } = renderHook(() => useFileListSort());
		act(() => result.current.toggleSort("name"));
		expect(result.current.sortDir).toBe("desc");
		act(() => result.current.toggleSort("name"));
		expect(result.current.sortDir).toBe("asc");
	});

	it("switching column resets direction to asc", () => {
		const { result } = renderHook(() => useFileListSort());
		act(() => result.current.toggleSort("name"));
		act(() => result.current.toggleSort("size"));
		expect(result.current.sortKey).toBe("size");
		expect(result.current.sortDir).toBe("asc");
	});

	// React runs state updaters twice in development: an updater that set the direction as a side effect
	// flipped it twice, so clicking the sorted column again did nothing there.
	it("flips the direction once under StrictMode", () => {
		const { result } = renderHook(() => useFileListSort(), { wrapper: StrictMode });
		act(() => result.current.toggleSort("name"));
		expect(result.current.sortDir).toBe("desc");
		act(() => result.current.toggleSort("size"));
		expect(result.current).toMatchObject({ sortKey: "size", sortDir: "asc" });
	});

	it("toggleSort is stable across renders", () => {
		const { result, rerender } = renderHook(() => useFileListSort());
		const first = result.current.toggleSort;
		rerender();
		expect(result.current.toggleSort).toBe(first);
	});
});
