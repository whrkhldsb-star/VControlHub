import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for `useAlertRuleActions`.
 *
 * Two properties matter here.
 *
 * 1. **One action at a time.** `beginBusy` is a *ref* check, so it holds within a
 *    single tick — unlike a state-based guard. Every mutating verb goes through
 *    it, which is what stops a double-clicked Delete from firing twice or a
 *    "trigger now" from overlapping a toggle. The keys are per-item
 *    (`toggle:<id>`), so the UI can show a spinner on the right row.
 *
 * 2. **A failed refresh is visible.** `refresh` re-reads the rule list, and the
 *    create-form's close handler calls it as a bare `void refresh()` — a
 *    rejection there used to be swallowed entirely, so a rule the user had just
 *    created looked like it had not been created at all. It now sets
 *    `actionError` itself while still rethrowing, so the wrapped callers keep
 *    attributing failures to their own action.
 */
const mocks = vi.hoisted(() => ({ csrfFetch: vi.fn(), addToast: vi.fn() }));

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: mocks.csrfFetch }));
vi.mock("@/components/toast-provider", () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
// The real provider memoizes this object (`useMemo` in i18n/provider.tsx), so the
// mock must return a stable reference too — a fresh object per render invalidates
// every `useCallback` that depends on `t` and drives the mount effect into an
// infinite loop that looks like a bug in the hook.
const i18n = { t: (key: string) => key };
vi.mock("@/lib/i18n/use-locale", () => ({ useI18n: () => i18n }));

import { useAlertRuleActions } from "../use-alert-rule-actions";

const rule = { id: "rule_1", name: "cpu high", enabled: true } as never;

function setup(canManage = true) {
	return renderHook(() =>
		useAlertRuleActions({ initialRules: [rule], canManage }),
	);
}

/** Deferred whose resolver is available before the promise is handed out. */
function deferred() {
	let resolve!: (value: unknown) => void;
	const promise = new Promise((r) => { resolve = r; });
	return { promise, resolve };
}

/** Wait for the mount-time incident load to finish. */
async function settled(result: { current: { incidentsLoading: boolean } }) {
	await waitFor(() => expect(result.current.incidentsLoading).toBe(false));
}

describe("useAlertRuleActions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.csrfFetch.mockReset();
		mocks.csrfFetch.mockResolvedValue({ rules: [rule], incidents: [] });
	});

	afterEach(() => {
		cleanup();
	});

	it("loads incidents on mount for a manager", async () => {
		const { result } = setup(true);
		await waitFor(() => expect(result.current.incidentsLoading).toBe(false));
		expect(mocks.csrfFetch).toHaveBeenCalledWith("/api/alert-incidents");
	});

	it("does not load incidents for a caller who cannot manage them", async () => {
		// `/api/alert-incidents` is notification:manage-gated; calling it anyway
		// would put a 403 toast on the page for a read-only viewer.
		const { result } = setup(false);
		await settled(result);
		expect(result.current.incidents).toEqual([]);
		expect(mocks.csrfFetch).not.toHaveBeenCalledWith("/api/alert-incidents");
	});

	describe("single-flight guard", () => {
		it("ignores a second delete for the same rule while the first is in flight", async () => {
			// Double-clicking Delete must not issue two DELETEs.
			const gate = deferred();
			mocks.csrfFetch.mockImplementation((url: string) =>
				String(url).includes("?id=") ? gate.promise : Promise.resolve({ rules: [] }),
			);
			const { result } = setup();
			await settled(result);
			await act(async () => {
				const first = result.current.deleteRule("rule_1");
				const second = result.current.deleteRule("rule_1");
				gate.resolve({});
				await Promise.all([first, second]);
			});
			const deletes = mocks.csrfFetch.mock.calls.filter((c) => c[1]?.method === "DELETE");
			expect(deletes).toHaveLength(1);
		});

		it("blocks a different action while one is running, since the guard is global", async () => {
			// A single busy ref means the whole toolbar is serialised — deliberate,
			// because `trigger now` and a toggle both mutate the same rule set.
			const gate = deferred();
			mocks.csrfFetch.mockImplementation((_url: string, init?: { method?: string }) =>
				init?.method === "PATCH" ? gate.promise : Promise.resolve({ rules: [] }),
			);
			const { result } = setup();
			await settled(result);
			await act(async () => {
				const first = result.current.toggleRule("rule_1");
				const second = result.current.triggerNow();
				gate.resolve({});
				await Promise.all([first, second]);
			});
			expect(mocks.csrfFetch.mock.calls.filter((c) => c[1]?.method === "PUT")).toHaveLength(0);
		});

		it("releases the guard so the next action can run", async () => {
			const { result } = setup();
			await settled(result);
			await result.current.toggleRule("rule_1");
			expect(result.current.busyAction).toBeNull();
			await result.current.triggerNow();
			expect(mocks.csrfFetch.mock.calls.filter((c) => c[1]?.method === "PUT")).toHaveLength(1);
		});

		it("releases the guard even when the request fails", async () => {
			mocks.csrfFetch.mockRejectedValue(new Error("offline"));
			const { result } = setup();
			await settled(result);
			await result.current.toggleRule("rule_1");
			expect(result.current.busyAction).toBeNull();
			expect(result.current.actionError).toBeTruthy();
		});

		it("keys the busy flag per rule so the spinner lands on the right row", async () => {
			const gate = deferred();
			mocks.csrfFetch.mockImplementation((_url: string, init?: { method?: string }) =>
				init?.method === "PATCH" ? gate.promise : Promise.resolve({ rules: [] }),
			);
			const { result } = setup();
			await settled(result);
			let pending: Promise<void> | undefined;
			await act(async () => {
				pending = result.current.toggleRule("rule_1");
				await Promise.resolve();
			});
			expect(result.current.busyAction).toBe("toggle:rule_1");
			await act(async () => { gate.resolve({}); await pending; });
		});
	});

	describe("refresh failure visibility", () => {
		it("surfaces its own error so a bare void refresh() is not silent", async () => {
			// The create-form close handler calls `void refresh()`; before this the
			// rejection vanished and the new rule appeared to be missing.
			//
			// The mount-time incident load must be allowed to SUCCEED here, or its
			// own failure sets `actionError` and the assertion passes even when
			// `refresh` swallows everything.
			const { result } = setup();
			await settled(result);
			expect(result.current.actionError).toBeNull();
			mocks.csrfFetch.mockRejectedValue(new Error("gateway timeout"));
			await result.current.refresh().catch(() => {});
			// `getErrorMessage` prefers the thrown message over the fallback copy, so
			// the user sees the real cause rather than a generic "refresh failed".
			await waitFor(() => expect(result.current.actionError).toBe("gateway timeout"));
		});

		it("still rethrows so wrapped callers report their own action's failure", async () => {
			const { result } = setup();
			await settled(result);
			mocks.csrfFetch.mockRejectedValue(new Error("gateway timeout"));
			await expect(
				act(async () => { await result.current.refresh(); }),
			).rejects.toThrow("gateway timeout");
		});

		it("replaces the rule list on a successful refresh", async () => {
			// Re-point the mock only *after* the mount-time incident load has
			// settled, or that in-flight response lands last and overwrites this.
			const next = { id: "rule_2", name: "disk full", enabled: false };
			const { result } = setup();
			await settled(result);
			mocks.csrfFetch.mockResolvedValue({ rules: [next] });
			await result.current.refresh();
			await waitFor(() => expect(result.current.rules).toEqual([next]));
		});

		it("treats a payload with no rules array as an empty list rather than crashing", async () => {
			const { result } = setup();
			await settled(result);
			mocks.csrfFetch.mockResolvedValue({});
			await result.current.refresh();
			await waitFor(() => expect(result.current.rules).toEqual([]));
		});
	});

	describe("actions", () => {
		it("acknowledges an incident by id and reloads the list", async () => {
			const { result } = setup();
			await settled(result);
			mocks.csrfFetch.mockClear();
			await result.current.ackIncident("inc_1");
			const post = mocks.csrfFetch.mock.calls.find((c) => c[1]?.method === "POST");
			expect(JSON.parse(post![1].body as string)).toEqual({ incidentId: "inc_1" });
			expect(mocks.csrfFetch).toHaveBeenCalledWith("/api/alert-incidents");
		});

		it("toggles by sending only toggleId", async () => {
			const { result } = setup();
			await settled(result);
			await result.current.toggleRule("rule_1");
			const patch = mocks.csrfFetch.mock.calls.find((c) => c[1]?.method === "PATCH");
			expect(JSON.parse(patch![1].body as string)).toEqual({ toggleId: "rule_1" });
		});

		it("clears the pending delete only after the request succeeds", async () => {
			const { result } = setup();
			await settled(result);
			act(() => { result.current.setRulePendingDelete(rule); });
			mocks.csrfFetch.mockRejectedValueOnce(new Error("in use"));
			await result.current.deleteRule("rule_1");
			// Still staged, so the dialog can show the error and let the user retry.
			expect(result.current.rulePendingDelete).not.toBeNull();
		});

		it("warns rather than reporting success when a test delivery failed", async () => {
			const { result } = setup();
			await settled(result);
			mocks.csrfFetch.mockResolvedValue({
				deliveries: [{ channel: "email", status: "failed" }, { channel: "telegram", status: "sent" }],
			});
			mocks.addToast.mockClear();
			await result.current.testRule(rule);
			expect(mocks.addToast).toHaveBeenCalledWith("warning", expect.stringContaining("testPartial"));
			await waitFor(() => expect(result.current.testResult).toMatchObject({ ruleName: "cpu high" }));
		});

		it("reports success when every delivery landed", async () => {
			const { result } = setup();
			await settled(result);
			mocks.csrfFetch.mockResolvedValue({ deliveries: [{ channel: "email", status: "sent" }] });
			mocks.addToast.mockClear();
			await result.current.testRule(rule);
			expect(mocks.addToast).toHaveBeenCalledWith("success", expect.stringContaining("testSucceeded"));
		});

		it("uses the rules the defaults call returned instead of a second round trip", async () => {
			mocks.csrfFetch.mockResolvedValue({ rules: [rule], created: 3 });
			const { result } = setup();
			await settled(result);
			mocks.csrfFetch.mockClear();
			await result.current.ensureDefaults();
			expect(mocks.csrfFetch.mock.calls.filter((c) => c[0] === "/api/alert-rules")).toHaveLength(1);
			expect(mocks.addToast).toHaveBeenCalledWith("success", expect.stringContaining("defaultsCreated"));
		});

		it("falls back to a refresh when the defaults call returns no rules", async () => {
			mocks.csrfFetch.mockResolvedValueOnce({ incidents: [] }).mockResolvedValue({ created: 0 });
			const { result } = setup();
			await settled(result);
			mocks.csrfFetch.mockClear();
			mocks.csrfFetch.mockResolvedValueOnce({ created: 0 }).mockResolvedValue({ rules: [rule] });
			await result.current.ensureDefaults();
			expect(mocks.csrfFetch.mock.calls.filter((c) => c[0] === "/api/alert-rules").length).toBeGreaterThan(1);
		});
	});
});
