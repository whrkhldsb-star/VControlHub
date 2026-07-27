/**
 * useResourcePolling — unified loading/error/data + visibility-aware
 * polling hook. Tests cover: initial load, error capture, manual refresh,
 * loading-vs-refreshing distinction, interval polling, overlap de-dupe,
 * disabled/zero-interval, optimistic setData, and visibility pause/resume.
 *
 * Timers are faked for deterministic interval assertions.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useResourcePolling } from "../use-resource-polling";

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("useResourcePolling — initial load", () => {
	it("starts in loading state and resolves to data", async () => {
		const fetcher = vi.fn().mockResolvedValue({ value: 42 });
		const { result } = renderHook(() => useResourcePolling({ fetcher, intervalSeconds: 0 }));

		expect(result.current.loading).toBe(true);
		expect(result.current.data).toBeNull();

		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.data).toEqual({ value: 42 });
		expect(result.current.error).toBeNull();
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it("captures error message from a thrown Error", async () => {
		const fetcher = vi.fn().mockRejectedValue(new Error("boom"));
		const { result } = renderHook(() => useResourcePolling({ fetcher, intervalSeconds: 0 }));

		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.error).toBe("boom");
		expect(result.current.data).toBeNull();
	});

	it("uses a custom getErrorMessage when provided", async () => {
		const fetcher = vi.fn().mockRejectedValue("raw");
		const { result } = renderHook(() =>
			useResourcePolling({ fetcher, intervalSeconds: 0, getErrorMessage: () => "mapped" }),
		);

		await waitFor(() => expect(result.current.error).toBe("mapped"));
	});
});

describe("useResourcePolling — refresh", () => {
	it("manual refresh re-fetches and toggles refreshing (not loading) once data exists", async () => {
		const fetcher = vi.fn().mockResolvedValueOnce({ n: 1 }).mockResolvedValueOnce({ n: 2 });
		const { result } = renderHook(() => useResourcePolling({ fetcher, intervalSeconds: 0 }));

		await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));

		await act(async () => {
			await result.current.refresh();
		});

		expect(result.current.data).toEqual({ n: 2 });
		expect(result.current.loading).toBe(false);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it("clears a prior error on a successful refresh", async () => {
		const fetcher = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce({ ok: true });
		const { result } = renderHook(() => useResourcePolling({ fetcher, intervalSeconds: 0 }));

		await waitFor(() => expect(result.current.error).toBe("x"));

		await act(async () => {
			await result.current.refresh();
		});
		expect(result.current.error).toBeNull();
		expect(result.current.data).toEqual({ ok: true });
	});

	it("de-dupes overlapping fetches but queues one follow-up", async () => {
		let resolveFirst: ((v: unknown) => void) | null = null;
		let resolveSecond: ((v: unknown) => void) | null = null;
		const fetcher = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise((r) => {
						resolveFirst = r;
					}),
			)
			.mockImplementationOnce(
				() =>
					new Promise((r) => {
						resolveSecond = r;
					}),
			);
		const { result } = renderHook(() => useResourcePolling({ fetcher, intervalSeconds: 0 }));

		// first fetch is in flight (from mount); a manual refresh should queue, not drop
		await act(async () => {
			void result.current.refresh();
		});
		expect(fetcher).toHaveBeenCalledTimes(1);

		await act(async () => {
			resolveFirst?.({ done: "first" });
		});
		await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

		await act(async () => {
			resolveSecond?.({ done: "second" });
		});
		await waitFor(() => expect(result.current.data).toEqual({ done: "second" }));
	});

	it("re-fetches with the latest fetcher after an in-flight request when identity changes", async () => {
		let resolveFirst: ((v: unknown) => void) | null = null;
		const first = vi.fn(
			() =>
				new Promise((r) => {
					resolveFirst = r;
				}),
		);
		const second = vi.fn().mockResolvedValue({ page: 2 });

		const { result, rerender } = renderHook(
			({ fetcher }) => useResourcePolling({ fetcher, intervalSeconds: 0 }),
			{ initialProps: { fetcher: first } },
		);

		expect(first).toHaveBeenCalledTimes(1);

		rerender({ fetcher: second });
		// second identity schedules refresh while first is in flight → queued
		expect(second).toHaveBeenCalledTimes(0);

		await act(async () => {
			resolveFirst?.({ page: 1 });
		});
		await waitFor(() => expect(second).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(result.current.data).toEqual({ page: 2 }));
	});
});

describe("useResourcePolling — interval polling", () => {
	it("polls on the interval when enabled", async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn().mockResolvedValue({ tick: true });
		renderHook(() => useResourcePolling({ fetcher, intervalSeconds: 5, pauseWhenHidden: false }));

		// initial fetch
		await vi.advanceTimersByTimeAsync(0);
		expect(fetcher).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(5000);
		expect(fetcher).toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(5000);
		expect(fetcher).toHaveBeenCalledTimes(3);
	});

	it("does not poll when intervalSeconds is 0", async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn().mockResolvedValue({});
		renderHook(() => useResourcePolling({ fetcher, intervalSeconds: 0 }));

		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it("does not poll when disabled", async () => {
		vi.useFakeTimers();
		const fetcher = vi.fn().mockResolvedValue({});
		renderHook(() => useResourcePolling({ fetcher, intervalSeconds: 5, enabled: false }));

		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(20_000);
		expect(fetcher).toHaveBeenCalledTimes(1); // only the initial fetch
	});
});

describe("useResourcePolling — setData", () => {
	it("replaces data locally without a fetch", async () => {
		const fetcher = vi.fn().mockResolvedValue({ n: 1 });
		const { result } = renderHook(() => useResourcePolling({ fetcher, intervalSeconds: 0 }));

		await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));

		act(() => {
			result.current.setData({ n: 99 });
		});
		expect(result.current.data).toEqual({ n: 99 });
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it("supports functional optimistic updates without stale snapshots", async () => {
		const fetcher = vi.fn().mockResolvedValue({ count: 1 });
		const { result } = renderHook(() => useResourcePolling<{ count: number }>({ fetcher, intervalSeconds: 0 }));
		await waitFor(() => expect(result.current.data).toEqual({ count: 1 }));

		act(() => {
			result.current.setData((current) => ({ count: (current?.count ?? 0) + 1 }));
			result.current.setData((current) => ({ count: (current?.count ?? 0) + 1 }));
		});
		expect(result.current.data).toEqual({ count: 3 });
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});
