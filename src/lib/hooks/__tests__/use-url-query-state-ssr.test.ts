import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ params: null as URLSearchParams | null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => navigation.params }));

import { useUrlQueryState } from "../use-url-query-state";

/**
 * The first state must be what the server rendered with. Under the App
 * Router that is the request's search params, which the server render and the
 * browser's first render share; the address bar is only the fallback.
 */
describe("useUrlQueryState first render", () => {
	afterEach(() => {
		navigation.params = null;
		window.history.replaceState({}, "", "/");
	});

	it("starts from the request's search params", () => {
		window.history.replaceState({}, "", "/audit");
		navigation.params = new URLSearchParams("severity=WARNING&page=3&other=1");
		const { result } = renderHook(() => useUrlQueryState({ severity: "", page: "1" }));
		expect(result.current.state).toEqual({ severity: "WARNING", page: "3" });
	});

	it("prefers a query the page normalised on the server", () => {
		navigation.params = new URLSearchParams("page=99");
		const { result } = renderHook(() => useUrlQueryState({ page: "1" }, { page: "6" }));
		expect(result.current.state).toEqual({ page: "6" });
	});

	it("falls back to the address bar outside the App Router", () => {
		window.history.replaceState({}, "", "/users?page=2");
		const { result } = renderHook(() => useUrlQueryState({ page: "1" }));
		expect(result.current.state).toEqual({ page: "2" });
	});
});
