import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useUrlQueryState } from "../use-url-query-state";

/**
 * Tests for `useUrlQueryState` — the hook that mirrors list filter/sort state
 * into the query string so back/forward and shared links restore it.
 *
 * Two behaviours are deliberate and easy to regress:
 *
 * 1. It writes with `history.replaceState`, not `pushState`. Every keystroke in a
 *    search box updates the state, so pushing would bury the previous page under
 *    dozens of entries and make the back button unusable.
 * 2. A value equal to its default is *removed* from the URL rather than written.
 *    That is what keeps a freshly opened list at a clean URL, and it is why the
 *    default map is captured per-render but the key list is frozen on mount.
 *
 * Used by the audit, users, operation-task and scheduled-task list clients.
 */
const initialHref = "/audit";

function setUrl(href: string) {
	window.history.replaceState({}, "", href);
}

describe("useUrlQueryState", () => {
	beforeEach(() => setUrl(initialHref));
	afterEach(() => setUrl(initialHref));

	it("seeds state from the current query string", () => {
		setUrl("/audit?q=nginx&status=FAILED");
		const { result } = renderHook(() => useUrlQueryState({ q: "", status: "" }));
		expect(result.current.state).toEqual({ q: "nginx", status: "FAILED" });
	});

	it("falls back to the defaults for absent or empty params", () => {
		setUrl("/audit?q=");
		const { result } = renderHook(() => useUrlQueryState({ q: "all", status: "OPEN" }));
		// An empty param is treated as absent, so the default wins.
		expect(result.current.state).toEqual({ q: "all", status: "OPEN" });
	});

	it("ignores query params outside the declared key set", () => {
		setUrl("/audit?q=nginx&evil=1");
		const { result } = renderHook(() => useUrlQueryState({ q: "" }));
		expect(result.current.state).toEqual({ q: "nginx" });
	});

	it("writes a changed field into the URL", () => {
		const { result } = renderHook(() => useUrlQueryState({ q: "" }));
		act(() => result.current.setField("q", "nginx"));
		expect(new URL(window.location.href).searchParams.get("q")).toBe("nginx");
	});

	it("removes a field once it returns to its default", () => {
		// Keeps a freshly-filtered-then-cleared list on a clean URL.
		const { result } = renderHook(() => useUrlQueryState({ q: "", status: "ALL" }));
		act(() => result.current.setField("q", "nginx"));
		act(() => result.current.setField("q", ""));
		expect(new URL(window.location.href).searchParams.has("q")).toBe(false);
	});

	it("omits a value that merely equals a non-empty default", () => {
		const { result } = renderHook(() => useUrlQueryState({ status: "ALL" }));
		act(() => result.current.setField("status", "FAILED"));
		expect(new URL(window.location.href).searchParams.get("status")).toBe("FAILED");
		act(() => result.current.setField("status", "ALL"));
		expect(new URL(window.location.href).searchParams.has("status")).toBe(false);
	});

	it("replaces rather than pushes, so typing does not fill the history stack", () => {
		const before = window.history.length;
		const { result } = renderHook(() => useUrlQueryState({ q: "" }));
		act(() => result.current.setField("q", "n"));
		act(() => result.current.setField("q", "ng"));
		act(() => result.current.setField("q", "ngi"));
		expect(window.history.length).toBe(before);
	});

	it("does not re-render when a field is set to the value it already has", () => {
		const { result } = renderHook(() => useUrlQueryState({ q: "" }));
		act(() => result.current.setField("q", "nginx"));
		const snapshot = result.current.state;
		act(() => result.current.setField("q", "nginx"));
		// Same object identity — the setter bails out instead of producing a new one.
		expect(result.current.state).toBe(snapshot);
	});

	it("patches several fields at once", () => {
		const { result } = renderHook(() => useUrlQueryState({ q: "", status: "", page: "1" }));
		act(() => result.current.patch({ q: "nginx", status: "FAILED" }));
		const params = new URL(window.location.href).searchParams;
		expect(params.get("q")).toBe("nginx");
		expect(params.get("status")).toBe("FAILED");
		expect(params.has("page")).toBe(false);
	});

	it("re-reads the query string on popstate so back/forward restores the filters", () => {
		const { result } = renderHook(() => useUrlQueryState({ q: "" }));
		act(() => result.current.setField("q", "nginx"));
		setUrl("/audit?q=apache");
		act(() => {
			window.dispatchEvent(new PopStateEvent("popstate"));
		});
		expect(result.current.state.q).toBe("apache");
	});

	it("preserves the path and hash when rewriting the query", () => {
		setUrl("/audit#row-7");
		const { result } = renderHook(() => useUrlQueryState({ q: "" }));
		act(() => result.current.setField("q", "nginx"));
		expect(window.location.pathname).toBe("/audit");
		expect(window.location.hash).toBe("#row-7");
	});

	it("leaves unrelated existing params in place", () => {
		setUrl("/audit?ref=email");
		const { result } = renderHook(() => useUrlQueryState({ q: "" }));
		act(() => result.current.setField("q", "nginx"));
		expect(new URL(window.location.href).searchParams.get("ref")).toBe("email");
	});

	it("url-encodes a value with special characters", () => {
		const { result } = renderHook(() => useUrlQueryState({ q: "" }));
		act(() => result.current.setField("q", "a b&c=d"));
		expect(window.location.search).toContain("q=a+b%26c%3Dd");
		expect(new URL(window.location.href).searchParams.get("q")).toBe("a b&c=d");
	});
});

