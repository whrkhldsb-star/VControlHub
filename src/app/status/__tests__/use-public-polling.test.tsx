import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_BACKOFF_MS, backoffDelay, usePublicPolling } from "../use-public-polling";

function setVisibility(state: "visible" | "hidden") {
	Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
	document.dispatchEvent(new Event("visibilitychange"));
}

async function flush() {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

describe("usePublicPolling", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		setVisibility("visible");
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("backs off exponentially with a cap", () => {
		expect(backoffDelay(15_000, 0)).toBe(15_000);
		expect(backoffDelay(15_000, 1)).toBe(30_000);
		expect(backoffDelay(15_000, 3)).toBe(120_000);
		expect(backoffDelay(15_000, 9)).toBe(MAX_BACKOFF_MS);
	});

	it("waits one interval after server-rendered data, then polls", async () => {
		const fetcher = vi.fn(async () => 2);
		const { result } = renderHook(() => usePublicPolling({ initial: 1, key: "k", intervalMs: 15_000, fetcher, initialFresh: true }));
		expect(fetcher).not.toHaveBeenCalled();
		await act(async () => {
			vi.advanceTimersByTime(15_000);
		});
		await flush();
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(result.current.data).toBe(2);
	});

	it("never overlaps requests and keeps the last good data on failure", async () => {
		let resolve!: (value: number) => void;
		const fetcher = vi.fn(() => new Promise<number>((r) => { resolve = r; }));
		const { result } = renderHook(() => usePublicPolling({ initial: 1, key: "k", intervalMs: 1_000, fetcher }));
		expect(fetcher).toHaveBeenCalledTimes(1);
		act(() => result.current.refresh());
		// refresh() abandons the in-flight request and starts exactly one new one.
		expect(fetcher).toHaveBeenCalledTimes(2);
		await act(async () => {
			vi.advanceTimersByTime(5_000);
		});
		expect(fetcher).toHaveBeenCalledTimes(2);
		await act(async () => resolve(5));
		await flush();
		expect(result.current.data).toBe(5);

		fetcher.mockImplementationOnce(async () => {
			throw new Error("offline");
		});
		await act(async () => {
			vi.advanceTimersByTime(1_000);
		});
		await flush();
		expect(result.current).toMatchObject({ data: 5, error: "offline", failures: 1 });
		// Next attempt after 2 × interval, not 1 ×.
		fetcher.mockImplementation(async () => 6);
		await act(async () => {
			vi.advanceTimersByTime(1_000);
		});
		expect(fetcher).toHaveBeenCalledTimes(3);
		await act(async () => {
			vi.advanceTimersByTime(1_000);
		});
		await flush();
		expect(fetcher).toHaveBeenCalledTimes(4);
		expect(result.current).toMatchObject({ data: 6, error: null, failures: 0 });
	});

	it("aborts a request that exceeds the timeout", async () => {
		const fetcher = vi.fn((signal: AbortSignal) => new Promise<number>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))));
		const { result } = renderHook(() => usePublicPolling({ initial: 0, key: "k", intervalMs: 15_000, fetcher, timeoutMs: 3_000 }));
		await act(async () => {
			vi.advanceTimersByTime(3_000);
		});
		await flush();
		expect(result.current.error).toBe("timeout");
	});

	it("pauses while hidden and catches up when visible again", async () => {
		const fetcher = vi.fn(async () => 1);
		renderHook(() => usePublicPolling({ initial: 0, key: "k", intervalMs: 10_000, fetcher, initialFresh: true }));
		setVisibility("hidden");
		await act(async () => {
			vi.advanceTimersByTime(60_000);
		});
		expect(fetcher).not.toHaveBeenCalled();
		act(() => setVisibility("visible"));
		await flush();
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it("fetches at once for a new key and stops on unmount", async () => {
		const fetcher = vi.fn(async () => 1);
		const { rerender, unmount } = renderHook(({ key }) => usePublicPolling({ initial: 0, key, intervalMs: 10_000, fetcher, initialFresh: true }), { initialProps: { key: "a" } });
		expect(fetcher).not.toHaveBeenCalled();
		rerender({ key: "b" });
		await flush();
		expect(fetcher).toHaveBeenCalledTimes(1);
		unmount();
		await act(async () => {
			vi.advanceTimersByTime(60_000);
		});
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});
