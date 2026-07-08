import { act, render, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SortIcon, useFileListSort } from "../use-file-list-sort";

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

	it("toggleSort is stable across renders", () => {
		const { result, rerender } = renderHook(() => useFileListSort());
		const first = result.current.toggleSort;
		rerender();
		expect(result.current.toggleSort).toBe(first);
	});
});

describe("SortIcon", () => {
	const onToggle = () => {};

	it("renders neutral ↕ when inactive", () => {
		const { container } = render(
			<SortIcon col="name" label="名称" sortKey="size" sortDir="asc" onToggle={onToggle} />,
		);
		expect(container.textContent).toBe("↕");
	});

	it("renders ↑ for active asc", () => {
		const { container } = render(
			<SortIcon col="name" label="名称" sortKey="name" sortDir="asc" onToggle={onToggle} />,
		);
		expect(container.textContent).toBe("↑");
	});

	it("renders ↓ for active desc", () => {
		const { container } = render(
			<SortIcon col="name" label="名称" sortKey="name" sortDir="desc" onToggle={onToggle} />,
		);
		expect(container.textContent).toBe("↓");
	});

	it("exposes a translated aria-label that names the column", () => {
		const { getByRole } = render(
			<SortIcon col="size" label="大小" ariaLabel="按 大小 排序" sortKey="name" sortDir="asc" onToggle={onToggle} />,
		);
		expect(getByRole("button", { name: "按 大小 排序" })).toBeInTheDocument();
	});

	it("falls back to label when ariaLabel is omitted", () => {
		const { getByRole } = render(
			<SortIcon col="size" label="大小" sortKey="name" sortDir="asc" onToggle={onToggle} />,
		);
		expect(getByRole("button", { name: "大小" })).toBeInTheDocument();
	});
});
