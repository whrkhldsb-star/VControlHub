import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "../ai-types";
import { AUTO_CONTINUE_DELAY_MS, MAX_CONSECUTIVE_AUTO_CONTINUES, useAiContinuation } from "../hooks/use-ai-continuation";
import type { TrackedAction } from "../hooks/use-hosted-action-tracker";

const turn = (id: string, status: string, extra: Partial<Message> = {}): Message => ({
	id, conversationId: "conv-1", role: "assistant", content: "", reasoningContent: null, imageUrls: "[]", model: null,
	inputTokens: null, outputTokens: null, latencyMs: null, createdAt: "2026-11-28T00:00:00.000Z",
	hostedActions: [{
		id: `act-${id}`, conversationId: "conv-1", messageId: id, toolCallId: "tc", serverId: "srv-1", actionType: "execute_command",
		actionName: "Execute command", params: "{}", status: status as never, riskLevel: "low", autoApproved: false, result: null,
		errorMessage: null, createdAt: "2026-11-28T00:00:00.000Z", approvedAt: null, executedAt: null, completedAt: null, server: null,
	}],
	...extra,
});

const watched = (actionId: string, status: TrackedAction["status"] = "COMPLETED"): Record<string, TrackedAction> => ({
	[actionId]: {
		actionId, conversationId: "conv-1", phase: "settled", status, commandRequestId: "cmd", autoContinue: true,
		live: null, pollFailed: false, cancel: "idle",
	},
});

type Props = Parameters<typeof useAiContinuation>[0];

function setup(overrides: Partial<Props> = {}) {
	const continueConversation = vi.fn(async () => true);
	const initialProps: Props = {
		activeConvId: "conv-1",
		messages: [turn("m1", "COMPLETED")],
		tracked: watched("act-m1"),
		streaming: false,
		composerDirty: false,
		continueConversation,
		...overrides,
	};
	const hook = renderHook((props: Props) => useAiContinuation(props), { initialProps });
	return { ...hook, continueConversation, initialProps };
}

describe("useAiContinuation", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("continues by itself, once, after a run this page watched to the end", async () => {
		const { result, continueConversation, rerender, initialProps } = setup();
		expect(result.current.state).toBe("auto");
		await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_CONTINUE_DELAY_MS - 1); });
		expect(continueConversation).not.toHaveBeenCalled();
		await act(async () => { await vi.advanceTimersByTimeAsync(1); });
		expect(continueConversation).toHaveBeenCalledOnce();
		// A failed continuation leaves the turn where it was: the button, never a retry loop.
		rerender({ ...initialProps });
		expect(result.current.state).toBe("available");
		await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
		expect(continueConversation).toHaveBeenCalledOnce();
	});

	it("only offers the button for a turn settled elsewhere (restored from history, or not run by this page)", async () => {
		const { result, continueConversation } = setup({ tracked: {} });
		expect(result.current.state).toBe("available");
		await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
		expect(continueConversation).not.toHaveBeenCalled();
		act(() => result.current.continueNow());
		expect(continueConversation).toHaveBeenCalledOnce();
	});

	it("waits while the user writes a message, and can be paused", async () => {
		const dirty = setup({ composerDirty: true });
		expect(dirty.result.current.state).toBe("available");
		await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
		expect(dirty.continueConversation).not.toHaveBeenCalled();
		dirty.unmount();

		const paused = setup();
		act(() => paused.result.current.pause());
		expect(paused.result.current.state).toBe("available");
		await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
		expect(paused.continueConversation).not.toHaveBeenCalled();
	});

	it("has nothing to continue while a stream is open, an action is still running, or the user wrote after", () => {
		expect(setup({ streaming: true }).result.current.state).toBe("hidden");
		expect(setup({ messages: [turn("m1", "EXECUTING")] }).result.current.state).toBe("hidden");
		const userAfter: Message = { ...turn("u1", "COMPLETED"), role: "user", hostedActions: [] };
		expect(setup({ messages: [turn("m1", "COMPLETED"), userAfter] }).result.current.state).toBe("hidden");
		const answered: Message = { ...turn("m2", "COMPLETED"), hostedActions: [] };
		expect(setup({ messages: [turn("m1", "COMPLETED"), answered] }).result.current.state).toBe("hidden");
	});

	it("ignores the page's own error bubbles when looking for the turn to continue", () => {
		const errorBubble: Message = { ...turn("stream-error-1", "COMPLETED"), hostedActions: [] };
		expect(setup({ messages: [turn("m1", "COMPLETED"), errorBubble] }).result.current.state).toBe("auto");
	});

	it(`stops continuing by itself after ${MAX_CONSECUTIVE_AUTO_CONTINUES} turns in a row until the user writes`, async () => {
		const { result, rerender, initialProps, continueConversation } = setup();
		for (let index = 1; index <= MAX_CONSECUTIVE_AUTO_CONTINUES; index += 1) {
			rerender({ ...initialProps, messages: [turn(`m${index}`, "COMPLETED")], tracked: watched(`act-m${index}`) });
			await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_CONTINUE_DELAY_MS); });
		}
		expect(continueConversation).toHaveBeenCalledTimes(MAX_CONSECUTIVE_AUTO_CONTINUES);
		rerender({ ...initialProps, messages: [turn("m-next", "COMPLETED")], tracked: watched("act-m-next") });
		expect(result.current).toMatchObject({ state: "available", limitReached: true });
		act(() => result.current.resetAutoBudget());
		expect(result.current.state).toBe("auto");
	});
});
