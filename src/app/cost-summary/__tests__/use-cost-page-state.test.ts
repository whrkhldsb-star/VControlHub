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

/** What the API client hands back for a good answer: the parsed body. */
function raw<T>(payload: T): T {
	return payload;
}

/** What it throws for a refusal: an error carrying the server's message. */
function refusal(message: string, status = 500) {
	return Object.assign(new Error(message), { name: "ApiError", status });
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
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
			const slow = deferred<unknown>();
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
			const slow = deferred<unknown>();
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
				slow.reject(refusal("boom"));
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
		it("toasts a refused summary with the server's reason", async () => {
			// It read "…: HTTP 503": the answer was taken raw and its message thrown away.
			mocks.csrfFetch.mockRejectedValue(refusal("数据库暂时不可用，请稍后重试", 503));
			const { result } = setup();
			await act(async () => { await result.current.refreshAll(); });
			await waitFor(() =>
				expect(mocks.addToast).toHaveBeenCalledWith("error", "costPage.error.load: 数据库暂时不可用，请稍后重试"),
			);
		});

		it("toasts a snapshots failure separately so the rest of the page stays usable", async () => {
			// Snapshots only power the trend chart; the failure must still surface
			// rather than leaving a silently empty chart.
			mocks.csrfFetch.mockImplementation((url: string) =>
				String(url).includes("/api/cost/snapshots")
					? Promise.reject(refusal("boom"))
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

	describe("save", () => {
		const fill = (result: { current: ReturnType<typeof useCostPageState> }) => act(() => {
			result.current.openCreate();
			result.current.setForm({ category: "vps", provider: "aws", amount: "10.00", currency: "CNY", effectiveDate: "2026-08-01", notes: "" } as never);
		});

		it("says the entry was saved, not the label of the button", async () => {
			const { result } = setup();
			fill(result);
			await act(async () => { await result.current.submitForm(); });
			expect(mocks.csrfFetch).toHaveBeenCalledWith("/api/cost/entries", expect.objectContaining({ method: "POST" }));
			expect(mocks.addToast).toHaveBeenCalledWith("success", "costPage.toast.saved");
			expect(result.current.showForm).toBe(false);
		});

		it("keeps the form open with the server's reason when the entry is refused", async () => {
			mocks.csrfFetch.mockImplementation((_url: string, init?: { method?: string }) =>
				init?.method === "POST"
					? Promise.reject(refusal("金额超出允许范围", 400))
					: Promise.resolve(raw({ summary: null, entries: [], snapshots: [] })),
			);
			const { result } = setup();
			fill(result);
			await act(async () => { await result.current.submitForm(); });
			// In the dialog that is still open, not in a toast that leaves while it is being read.
			expect(result.current.formError).toBe("costPage.error.save: 金额超出允许范围");
			expect(mocks.addToast).not.toHaveBeenCalledWith("error", expect.anything());
			expect(result.current.showForm).toBe(true);
			// Editing the form takes the reason away; so does opening it again.
			act(() => { result.current.setForm({ category: "vps", provider: "aws", amount: "9.00", currency: "CNY", effectiveDate: "2026-08-01", notes: "" } as never); });
			expect(result.current.formError).toBeNull();
		});

		it("says in the dialog which required field is missing, before anything is sent", async () => {
			const { result } = setup();
			act(() => { result.current.openCreate(); });
			mocks.csrfFetch.mockClear();
			await act(async () => { await result.current.submitForm(); });
			expect(result.current.formError).toBe("costPage.form.error.required");
			expect(mocks.csrfFetch.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(0);
			act(() => { result.current.openCreate(); });
			expect(result.current.formError).toBeNull();
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
			// Says what happened; it used to show the label of the button that was pressed ("确认删除").
			expect(mocks.addToast).toHaveBeenCalledWith("success", "costPage.toast.deleted");
		});

		it("keeps the dialog staged when the delete fails so the user can retry", async () => {
			mocks.csrfFetch.mockImplementation((_url: string, init?: { method?: string }) =>
				init?.method === "DELETE"
					? Promise.reject(refusal("该条目已同步自云账单，不能删除", 409))
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
			// The reason is the dialog's to show (ConfirmDialog `error`).
			expect(result.current.deleteError).toBe("costPage.error.delete: 该条目已同步自云账单，不能删除");
			expect(mocks.addToast).not.toHaveBeenCalledWith("error", expect.anything());
			act(() => { result.current.setConfirmDelete(null); });
			expect(result.current.deleteError).toBeNull();
		});
	});
});
