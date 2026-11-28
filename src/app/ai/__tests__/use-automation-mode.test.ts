import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: fetchMock }));
vi.mock("@/lib/i18n/use-locale", () => ({
	useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key), locale: "en" }),
}));

import { type AiCapabilities, DEFAULT_AI_CAPABILITIES } from "../ai-automation-mode";
import type { ConvItem } from "../ai-types";
import { useAutomationMode } from "../hooks/use-automation-mode";

const conv = (overrides: Partial<ConvItem> = {}): ConvItem => ({
	id: "conv-1", title: "c", providerId: "p", model: "m", systemPrompt: null, temperature: 0.7, maxTokens: 4096, topP: 1,
	frequencyPenalty: 0, presencePenalty: 0, enableVision: false, hostingEnabled: true, automationMode: "ASSISTED",
	automationModeExpiresAt: null, pinnedServerIds: [], createdBy: "u", createdAt: "2026-11-01T00:00:00.000Z",
	updatedAt: "2026-11-01T00:00:00.000Z", provider: null, ...overrides,
});

const allModes: AiCapabilities = {
	...DEFAULT_AI_CAPABILITIES,
	canAuto: true,
	canFullAuto: true,
	canExecute: true,
	aiMaxAutomationMode: "full_auto",
	aiCommandPolicy: "high_risk",
};

function setup(initial: ConvItem, caps: AiCapabilities = allModes) {
	const updated = vi.fn();
	const addToast = vi.fn();
	const hook = renderHook(
		({ activeConv }) => useAutomationMode({ activeConv, caps, onConversationUpdated: updated, addToast }),
		{ initialProps: { activeConv: initial as ConvItem | null } },
	);
	return { ...hook, updated, addToast };
}

const patchBodies = () => fetchMock.mock.calls
	.filter(([, init]) => init?.method === "PATCH")
	.map(([url, init]) => [url, JSON.parse(init.body as string)]);

describe("useAutomationMode", () => {
	beforeEach(() => {
		fetchMock.mockReset();
		fetchMock.mockImplementation(async (_url: string, init?: { body?: string }) => ({
			conversation: conv(init?.body ? JSON.parse(init.body) : {}),
		}));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("saves a mode at once and hands the updated conversation back", async () => {
		const { result, updated } = setup(conv());
		await act(async () => { result.current.requestMode("AUTO"); });
		expect(patchBodies()).toEqual([["/api/ai/conversations/conv-1", { automationMode: "AUTO" }]]);
		expect(updated).toHaveBeenCalledWith(expect.objectContaining({ automationMode: "AUTO" }));
	});

	it("turns the server tools on when a mode is chosen with them off", async () => {
		const { result } = setup(conv({ hostingEnabled: false }));
		await act(async () => { result.current.requestMode("PLAN_ONLY"); });
		expect(patchBodies()).toEqual([["/api/ai/conversations/conv-1", { automationMode: "PLAN_ONLY", hostingEnabled: true }]]);
	});

	it("never sends a locked mode, and says why", async () => {
		const { result, addToast } = setup(conv(), { ...allModes, canFullAuto: false, aiMaxAutomationMode: "auto" });
		await act(async () => { result.current.requestMode("FULL_AUTO"); });
		expect(fetchMock).not.toHaveBeenCalled();
		expect(result.current.fullAutoDialogOpen).toBe(false);
		expect(addToast).toHaveBeenCalledWith("error", expect.stringContaining("aiPage.mode.lock.platform_ceiling"));
	});

	it("asks before Full auto, then saves it with the chosen window", async () => {
		const { result } = setup(conv());
		act(() => { result.current.requestMode("FULL_AUTO"); });
		expect(result.current.fullAutoDialogOpen).toBe(true);
		expect(fetchMock).not.toHaveBeenCalled();
		await act(async () => { await result.current.confirmFullAuto(15); });
		expect(patchBodies()).toEqual([["/api/ai/conversations/conv-1", { automationMode: "FULL_AUTO", automationModeTtlMinutes: 15 }]]);
		expect(result.current.fullAutoDialogOpen).toBe(false);
	});

	it("keeps the dialog open when the server refuses Full auto", async () => {
		fetchMock.mockRejectedValueOnce(new Error("forbidden"));
		const { result, addToast } = setup(conv());
		act(() => { result.current.requestMode("FULL_AUTO"); });
		await act(async () => { await result.current.confirmFullAuto(30); });
		expect(result.current.fullAutoDialogOpen).toBe(true);
		expect(addToast).toHaveBeenCalledWith("error", "forbidden");
	});

	it("drops back to Confirm in one call", async () => {
		const { result } = setup(conv({ automationMode: "FULL_AUTO", automationModeExpiresAt: new Date(Date.now() + 60_000).toISOString() }));
		await act(async () => { result.current.dropToConfirm(); });
		expect(patchBodies()).toEqual([["/api/ai/conversations/conv-1", { automationMode: "ASSISTED" }]]);
	});

	it("cycles with Shift+Tab, asks before Full auto, and moves on when that is dismissed", async () => {
		const { result, rerender } = setup(conv({ automationMode: "ASSISTED" }));
		let handled = false;
		await act(async () => { handled = result.current.cycleMode(); });
		expect(handled).toBe(true);
		expect(patchBodies().at(-1)).toEqual(["/api/ai/conversations/conv-1", { automationMode: "AUTO" }]);

		rerender({ activeConv: conv({ automationMode: "AUTO" }) });
		await act(async () => { result.current.cycleMode(); });
		// Full auto is never entered by a key press alone.
		expect(result.current.fullAutoDialogOpen).toBe(true);
		expect(patchBodies()).toHaveLength(1);
		act(() => { result.current.closeFullAutoDialog(); });

		// The next press goes on to Plan instead of opening the dialog again.
		await act(async () => { result.current.cycleMode(); });
		expect(result.current.fullAutoDialogOpen).toBe(false);
		expect(patchBodies().at(-1)).toEqual(["/api/ai/conversations/conv-1", { automationMode: "PLAN_ONLY" }]);
	});

	it("leaves Shift+Tab alone when there is nothing to cycle (server tools off, a single mode)", () => {
		const off = setup(conv({ hostingEnabled: false }));
		expect(off.result.current.cycleMode()).toBe(false);
		const single = setup(conv(), { ...allModes, aiMaxAutomationMode: "plan" });
		expect(single.result.current.cycleMode()).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("counts the Full auto window down and reports Confirm once it ended", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-11-28T10:00:00.000Z"));
		const { result } = setup(conv({ automationMode: "FULL_AUTO", automationModeExpiresAt: "2026-11-28T10:00:03.000Z" }));
		// No clock is read during render: the countdown appears on the first tick.
		expect(result.current.effective.remainingMs).toBeNull();
		await act(async () => { await vi.advanceTimersByTimeAsync(0); });
		expect(result.current.effective).toMatchObject({ effective: "FULL_AUTO", remainingMs: 3_000 });
		await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
		expect(result.current.effective).toMatchObject({ effective: "ASSISTED", downgraded: true, reasons: ["expired"], remainingMs: null });
	});

	it("closes the Full auto confirmation dialog when switching conversations (Astra P2-2)", async () => {
		const { result, rerender } = setup(conv({ id: "conv-1" }));
		act(() => { result.current.requestMode("FULL_AUTO"); });
		expect(result.current.fullAutoDialogOpen).toBe(true);

		rerender({ activeConv: conv({ id: "conv-2" }) });
		expect(result.current.fullAutoDialogOpen).toBe(false);
		await act(async () => { await result.current.confirmFullAuto(15); });
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
