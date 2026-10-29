import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ params: new URLSearchParams("") }));
vi.mock("next/navigation", () => ({ useSearchParams: () => router.params }));

import { useUrlQueryState } from "../use-url-query-state";

/**
 * A link to the same page with another query leaves the page mounted (Next: "search params do not remount"). The
 * audit page's "high-risk" shortcuts are such links: the address bar changed and the list did not.
 */
describe("useUrlQueryState when the router reports a new query", () => {
	beforeEach(() => { router.params = new URLSearchParams(""); window.history.replaceState({}, "", "/audit"); });
	afterEach(() => window.history.replaceState({}, "", "/audit"));

	it("adopts a query it did not write itself", () => {
		const { result, rerender } = renderHook(() => useUrlQueryState({ action: "", q: "" }));
		expect(result.current.state).toEqual({ action: "", q: "" });

		router.params = new URLSearchParams("action=server.delete");
		window.history.replaceState({}, "", "/audit?action=server.delete");
		rerender();

		expect(result.current.state).toEqual({ action: "server.delete", q: "" });
	});

	it("does not take its own write, reported back by the router, for news", () => {
		const { result, rerender } = renderHook(() => useUrlQueryState({ action: "" }));
		act(() => result.current.setField("action", "auth.login"));
		router.params = new URLSearchParams("action=auth.login");
		rerender();
		expect(result.current.state.action).toBe("auth.login");

		// A later change is not reverted by a router that is still reporting the previous query.
		act(() => result.current.setField("action", "command.execute"));
		rerender();
		expect(result.current.state.action).toBe("command.execute");
	});
});
