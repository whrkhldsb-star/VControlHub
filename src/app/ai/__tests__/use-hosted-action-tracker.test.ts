import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: fetchMock }));
vi.mock("@/lib/i18n/use-locale", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import { ApiError } from "@/lib/http/api-client-error";
import type { HostedActionLive, Message } from "../ai-types";
import { pollIntervalFor, RUN_POLL_INTERVAL_MS, type TrackedAction, useHostedActionTracker } from "../hooks/use-hosted-action-tracker";

const liveAnswer = (status: HostedActionLive["action"]["status"], commandStatus = status === "EXECUTING" ? "RUNNING" : status): HostedActionLive => ({
	action: { id: "act-1", status, commandRequestId: "cmd-1" },
	command: { id: "cmd-1", status: commandStatus, command: "uptime", origin: "AI_CHAT", riskLevel: "low", decisionSource: "REQUESTER_CONFIRMED", targets: [] },
});

const transcript = (status: string, extra: Record<string, unknown> = {}): Message[] => [{
	id: "msg-1", conversationId: "conv-1", role: "assistant", content: "", reasoningContent: null, imageUrls: "[]", model: null,
	inputTokens: null, outputTokens: null, latencyMs: null, createdAt: "2026-11-28T00:00:00.000Z",
	hostedActions: [{
		id: "act-1", conversationId: "conv-1", messageId: "msg-1", toolCallId: "tc-1", serverId: "srv-1", actionType: "execute_command",
		actionName: "Execute command", params: "{}", status: status as never, riskLevel: "low", autoApproved: false, result: null,
		errorMessage: null, createdAt: "2026-11-28T00:00:00.000Z", approvedAt: null, executedAt: null, completedAt: null, server: null,
		commandRequestId: "cmd-1", ...extra,
	}],
}];

const gets = () => fetchMock.mock.calls.filter(([url, init]) => String(url).startsWith("/api/ai/hosted-actions/") && !init?.method);

function setup(initial: { activeConvId: string | null; messages: Message[] }) {
	const onSettled = vi.fn<(action: TrackedAction) => void>();
	const addToast = vi.fn();
	const hook = renderHook(
		(props: { activeConvId: string | null; messages: Message[] }) => useHostedActionTracker({ ...props, addToast, onSettled }),
		{ initialProps: initial },
	);
	return { ...hook, onSettled, addToast };
}

describe("useHostedActionTracker", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		fetchMock.mockReset();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("polls a confirmed run every 1.5 s, reports it once when it settles, then stops", async () => {
		fetchMock
			.mockResolvedValueOnce(liveAnswer("EXECUTING"))
			.mockResolvedValueOnce(liveAnswer("COMPLETED"));
		const { result, onSettled } = setup({ activeConvId: "conv-1", messages: [] });
		act(() => { result.current.track({ actionId: "act-1", conversationId: "conv-1", mode: "run", commandRequestId: "cmd-1", autoContinue: true }); });
		await act(async () => { await vi.advanceTimersByTimeAsync(0); });
		expect(gets().map(([url]) => url)).toEqual(["/api/ai/hosted-actions/act-1"]);
		expect(result.current.tracked["act-1"]).toMatchObject({ phase: "running", status: "EXECUTING", autoContinue: true, commandRequestId: "cmd-1" });

		await act(async () => { await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS - 600); });
		expect(gets()).toHaveLength(1);
		await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
		expect(gets()).toHaveLength(2);
		expect(result.current.tracked["act-1"]).toMatchObject({ phase: "settled", status: "COMPLETED" });
		expect(onSettled).toHaveBeenCalledOnce();
		expect(onSettled.mock.calls[0]![0]).toMatchObject({ actionId: "act-1", status: "COMPLETED" });

		await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
		expect(gets()).toHaveLength(2);
	});

	it("follows an action the transcript shows running, without being told to", async () => {
		fetchMock.mockResolvedValue(liveAnswer("EXECUTING"));
		const { result } = setup({ activeConvId: "conv-1", messages: transcript("EXECUTING") });
		expect(result.current.tracked["act-1"]).toMatchObject({ phase: "running", autoContinue: false, commandRequestId: "cmd-1" });
		await act(async () => { await vi.advanceTimersByTimeAsync(0); });
		expect(gets()).toHaveLength(1);
	});

	it("checks a request under peer review only now and then", async () => {
		fetchMock.mockResolvedValue(liveAnswer("APPROVED", "PENDING_APPROVAL"));
		const { result } = setup({ activeConvId: "conv-1", messages: transcript("APPROVED") });
		expect(result.current.tracked["act-1"]).toMatchObject({ phase: "review" });
		await act(async () => { await vi.advanceTimersByTimeAsync(0); });
		await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
		expect(gets()).toHaveLength(1);
		await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
		expect(gets()).toHaveLength(2);
	});

	it("treats a reviewed request whose command now runs as running", async () => {
		fetchMock.mockResolvedValue(liveAnswer("APPROVED", "RUNNING"));
		const { result } = setup({ activeConvId: "conv-1", messages: transcript("APPROVED") });
		await act(async () => { await vi.advanceTimersByTimeAsync(0); });
		expect(result.current.tracked["act-1"]).toMatchObject({ phase: "running", status: "APPROVED" });
	});

	it("lets a final transcript win over an older poll answer", async () => {
		fetchMock.mockResolvedValue(liveAnswer("EXECUTING"));
		const { result, rerender } = setup({ activeConvId: "conv-1", messages: transcript("EXECUTING") });
		await act(async () => { await vi.advanceTimersByTimeAsync(0); });
		rerender({ activeConvId: "conv-1", messages: transcript("COMPLETED") });
		expect(result.current.tracked["act-1"]).toBeUndefined();
	});

	it("stops polling when the conversation changes", async () => {
		fetchMock.mockResolvedValue(liveAnswer("EXECUTING"));
		const { rerender } = setup({ activeConvId: "conv-1", messages: transcript("EXECUTING") });
		await act(async () => { await vi.advanceTimersByTimeAsync(0); });
		expect(gets()).toHaveLength(1);
		rerender({ activeConvId: "conv-2", messages: [] });
		await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
		expect(gets()).toHaveLength(1);
	});

	it("stops following an action the server no longer shows to this account", async () => {
		fetchMock.mockRejectedValue(new ApiError(404, { message: "not found" }));
		const { result } = setup({ activeConvId: "conv-1", messages: transcript("EXECUTING") });
		await act(async () => { await vi.advanceTimersByTimeAsync(0); });
		expect(result.current.tracked["act-1"]).toMatchObject({ phase: "settled" });
		await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
		expect(gets()).toHaveLength(1);
	});

	it("cancels the command behind a running action through PATCH /api/commands", async () => {
		fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) =>
			init?.method === "PATCH" ? { command: { id: "cmd-1", status: "CANCELLING" } } : liveAnswer("EXECUTING"));
		const { result } = setup({ activeConvId: "conv-1", messages: transcript("EXECUTING") });
		await act(async () => { await vi.advanceTimersByTimeAsync(0); });
		await act(async () => { await result.current.cancel("act-1"); });
		expect(fetchMock).toHaveBeenCalledWith("/api/commands", expect.objectContaining({
			method: "PATCH",
			body: JSON.stringify({ action: "cancel", commandRequestId: "cmd-1", reason: "aiPage.live.cancelReason" }),
		}));
		expect(result.current.tracked["act-1"]!.cancel).toBe("requested");
	});

	it("says why a cancellation was refused", async () => {
		fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) => {
			if (init?.method === "PATCH") throw new Error("命令已经结束");
			return liveAnswer("EXECUTING");
		});
		const { result, addToast } = setup({ activeConvId: "conv-1", messages: transcript("EXECUTING") });
		await act(async () => { await result.current.cancel("act-1"); });
		expect(result.current.tracked["act-1"]!.cancel).toBe("failed");
		expect(addToast).toHaveBeenCalledWith("error", "命令已经结束");
	});

	it("backs off on failures, for long runs and in hidden tabs", () => {
		expect(pollIntervalFor({ phase: "running", failures: 0, elapsedMs: 0, hidden: false })).toBe(1_500);
		expect(pollIntervalFor({ phase: "running", failures: 0, elapsedMs: 3 * 60_000, hidden: false })).toBe(3_000);
		expect(pollIntervalFor({ phase: "running", failures: 0, elapsedMs: 11 * 60_000, hidden: false })).toBe(5_000);
		expect(pollIntervalFor({ phase: "running", failures: 2, elapsedMs: 0, hidden: false })).toBe(6_000);
		expect(pollIntervalFor({ phase: "running", failures: 9, elapsedMs: 0, hidden: false })).toBe(30_000);
		expect(pollIntervalFor({ phase: "running", failures: 0, elapsedMs: 0, hidden: true })).toBe(10_000);
		expect(pollIntervalFor({ phase: "review", failures: 0, elapsedMs: 0, hidden: false })).toBe(15_000);
	});
});
