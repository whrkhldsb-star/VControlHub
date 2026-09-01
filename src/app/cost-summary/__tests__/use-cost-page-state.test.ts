import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for `useCostPageState`.
 *
 * The property worth pinning is the **out-of-order response guard**. Each of the
 * three loaders bumps its own sequence ref and drops its result when a newer
 * request has started (`if (seq !== summaryReqSeq.current) return`). The page's
 * filters are a month picker and a currency select, so flipping months quickly
 * issues overlapping requests; without the guard a slow response for July
 * repaints over August and the page silently shows the wrong month's spend.
 *
 * The individual fetches are internal — `onChangeMonth` / `onChangeCurrency` /
 * `refreshAll` are the public entry points, so the races are driven through
 * those, which is also how a user reaches them.
 */
const mocks = vi.hoisted(() => ({ csrfFetch: vi.fn(), addToast: vi.fn() }));

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: mocks.csrfFetch }));

import { useCostPageState } from "../use-cost-page-state";

/** A raw-mode Response stand-in; this hook fetches with `raw: true`. */
function raw(payload: unknown, { ok = true, status = 200 } = {}) {
	return { ok, status, json: async () => payload } as unknown as Response;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => { resolve = r; });
	return { promise, resolve };
}

function setup() {
	return renderHook(() =>
		useCostPageState({
			initialMonth: "2026-08",
			initialCurrency: "CNY",
			initialSummary: null,
			initialEntries: [],
			initialSnapshots: [],
			canManage: true,
			t: ((key: string) => key) as never,
			locale: "zh",
			addToast: mocks.addToast as never,
		} as never),
	);
}

describe("useCostPageState", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.csrfFetch.mockReset();
		mocks.csrfFetch.mockResolvedValue(raw({ summary: null, entries: [], snapshots: [] }));
	});

	describe("out-of-order responses", () => {
		it("drops a stale summary so a slow old month cannot repaint the new one", async () => {
			const slow = deferred<Response>();
			mocks.csrfFetch.mockImplementation((url: string) => {
				const u = String(url);
				if (u.includes("/api/cost/summary?month=2026-07")) return slow.promise;
				if (u.includes("/api/cost/summary")) {
					return Promise.resolve(raw({ summary: { totalAmount: "200.00" } }));
				}
				return Promise.resolve(raw({ entries: [], snapshots: [] }));
			});
			const { result } = setup();

			// Navigate to July, then immediately on to August before July answers.
			await act(async () => {
				result.current.onChangeMonth("2026-07");
			});
			await act(async () => {
				result.current.onChangeMonth("2026-08");
			});
			// July finally answers — with a value that must be discarded.
			await act(async () => {
				slow.resolve(raw({ summary: { totalAmount: "999.99" } }));
				await Promise.resolve();
			});

			await waitFor(() =>
				expect(result.current.summary).toMatchObject({ totalAmount: "200.00" }),
			);
		});

		it("suppresses a stale error toast as well as a stale result", async () => {
			// A superseded request that *fails* must not put an error on screen for a
			// month the user already navigated away from.
			const slow = deferred<Response>();
			mocks.csrfFetch.mockImplementation((url: string) => {
				const u = String(url);
				if (u.includes("month=2026-07")) return slow.promise;
				return Promise.resolve(raw({ summary: { totalAmount: "1.00" }, entries: [], snapshots: [] }));
			});
			const { result } = setup();
			await act(async () => { result.current.onChangeMonth("2026-07"); });
			await act(async () => { result.current.onChangeMonth("2026-08"); });
			mocks.addToast.mockClear();
			await act(async () => {
				slow.resolve(raw({}, { ok: false, status: 500 }));
				await Promise.resolve();
			});
			expect(mocks.addToast).not.toHaveBeenCalled();
		});

		it("switches currency without losing the newest snapshots", async () => {
			mocks.csrfFetch.mockImplementation((url: string) => {
				const u = String(url);
				if (u.includes("/api/cost/snapshots")) {
					return Promise.resolve(
						raw({ snapshots: [{ snapshotDate: "2026-08-01", totalAmount: "3.00" }] }),
					);
				}
				return Promise.resolve(raw({ summary: null, entries: [] }));
			});
			const { result } = setup();
			await act(async () => { result.current.onChangeCurrency("USD" as never); });
			await waitFor(() => expect(result.current.currency).toBe("USD"));
			expect(result.current.trend.length).toBeGreaterThan(0);
		});
	});

	describe("failures are reported", () => {
		it("toasts a non-ok summary response", async () => {
			mocks.csrfFetch.mockResolvedValue(raw({}, { ok: false, status: 503 }));
			const { result } = setup();
			await act(async () => { await result.current.refreshAll(); });
			await waitFor(() =>
				expect(mocks.addToast).toHaveBeenCalledWith(
					"error",
					expect.stringContaining("costPage.error.load"),
				),
			);
		});

		it("toasts a snapshots failure separately so the rest of the page stays usable", async () => {
			// Snapshots only power the trend chart; the failure must still surface
			// rather than leaving a silently empty chart.
			mocks.csrfFetch.mockImplementation((url: string) =>
				String(url).includes("/api/cost/snapshots")
					? Promise.resolve(raw({}, { ok: false, status: 500 }))
					: Promise.resolve(raw({ summary: null, entries: [] })),
			);
			const { result } = setup();
			await act(async () => { await result.current.refreshAll(); });
			await waitFor(() =>
				expect(mocks.addToast).toHaveBeenCalledWith(
					"error",
					expect.stringContaining("costPage.error.loadSnapshots"),
				),
			);
		});
	});

	describe("delete", () => {
		it("does nothing when no entry is staged", async () => {
			const { result } = setup();
			mocks.csrfFetch.mockClear();
			await act(async () => { await result.current.onConfirmDelete(); });
			expect(mocks.csrfFetch.mock.calls.filter((c) => c[1]?.method === "DELETE")).toHaveLength(0);
		});

		it("deletes the staged entry and clears the dialog", async () => {
			const { result } = setup();
			act(() => {
				result.current.requestDelete({ id: "e1", provider: "aws", amount: "10.00", currency: "CNY" } as never);
			});
			await waitFor(() => expect(result.current.confirmDelete).not.toBeNull());
			await act(async () => { await result.current.onConfirmDelete(); });
			expect(mocks.csrfFetch).toHaveBeenCalledWith(
				"/api/cost/entries/e1",
				expect.objectContaining({ method: "DELETE" }),
			);
			await waitFor(() => expect(result.current.confirmDelete).toBeNull());
		});

		it("keeps the dialog staged when the delete fails so the user can retry", async () => {
			mocks.csrfFetch.mockImplementation((_url: string, init?: { method?: string }) =>
				init?.method === "DELETE"
					? Promise.resolve(raw({}, { ok: false, status: 409 }))
					: Promise.resolve(raw({ summary: null, entries: [], snapshots: [] })),
			);
			const { result } = setup();
			act(() => {
				result.current.requestDelete({ id: "e1", provider: "aws", amount: "10.00", currency: "CNY" } as never);
			});
			await waitFor(() => expect(result.current.confirmDelete).not.toBeNull());
			await act(async () => { await result.current.onConfirmDelete(); });
			expect(result.current.confirmDelete).not.toBeNull();
			expect(result.current.deletingId).toBeNull();
			expect(mocks.addToast).toHaveBeenCalledWith("error", expect.stringContaining("costPage.error.delete"));
		});
	});
});
