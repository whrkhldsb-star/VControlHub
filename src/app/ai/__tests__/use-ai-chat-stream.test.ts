import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for `useAiChatStream` — the SSE loop behind the AI chat surface.
 *
 * The correctness-critical property is the **conversation pin**. `sendMessage`
 * captures `activeConvId` as `convIdAtSend` and compares it against a ref before
 * every transcript write, because the user can switch chats mid-stream. Without
 * that guard, a reply (or an error bubble, or a whole server-refreshed message
 * list) belonging to conversation A gets written into whatever conversation is
 * open when the stream finishes — one chat's content appearing in another.
 *
 * The second property is that a terminal failure is always *visible*. The stream
 * bubble is only rendered while `streaming === true`, and `finally` wipes
 * `streamContent`, so an HTTP/SSE/network error that did not append a message
 * would vanish silently and take the optimistic user bubble with it. Hence: HTTP
 * error, in-band `{type:"error"}` frame, and a thrown network error all have to
 * produce both a message and a toast.
 */
const mocks = vi.hoisted(() => ({ csrfFetch: vi.fn() }));

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: mocks.csrfFetch }));
vi.mock("@/lib/i18n/use-locale", () => ({
	useI18n: () => ({ t: (key: string) => key }),
}));

import { useAiChatStream } from "../hooks/use-ai-chat-stream";

/** Build a streaming Response whose body emits the given SSE frames. */
function sseResponse(frames: unknown[], { ok = true } = {}) {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			for (const frame of frames) {
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
			}
			controller.close();
		},
	});
	return { ok, body, json: async () => ({}) } as unknown as Response;
}

type Harness = {
	messages: Array<Record<string, unknown>>;
	toasts: Array<{ kind: string; message: string }>;
	refreshed: number;
};

function setup(activeConvId: string | null = "conv_a") {
	const state: Harness = { messages: [], toasts: [], refreshed: 0 };
	const args = {
		activeConv: { id: activeConvId, model: "claude-opus-5" } as never,
		activeConvId,
		setMessages: ((next: unknown) => {
			state.messages = typeof next === "function"
				? (next as (p: unknown[]) => Array<Record<string, unknown>>)(state.messages)
				: (next as Array<Record<string, unknown>>);
		}) as never,
		refreshConversations: () => { state.refreshed += 1; },
		addToast: (kind: "success" | "error" | "info", message: string) => { state.toasts.push({ kind, message }); },
	};
	return { state, args };
}

const sendArgs = { content: "hi", imageUrls: [], imageBase64: [], fileAttachments: [] };

describe("useAiChatStream", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.csrfFetch.mockReset();
	});

	it("appends the assistant reply on a done frame", async () => {
		mocks.csrfFetch.mockImplementation(async (url: string) => {
			if (url === "/api/ai/chat") {
				return sseResponse([
					{ type: "content", content: "hello " },
					{ type: "content", content: "world" },
					{ type: "done", inputTokens: 10, outputTokens: 4, latencyMs: 120 },
				]);
			}
			return { conversation: { messages: [{ id: "server_1", role: "assistant", content: "hello world" }] } };
		});
		const { state, args } = setup();
		const { result } = renderHook(() => useAiChatStream(args));
		await act(async () => { await result.current.sendMessage(sendArgs); });
		// The server refresh replaces the optimistic bubble with the stored copy.
		expect(state.messages).toEqual([{ id: "server_1", role: "assistant", content: "hello world" }]);
		expect(state.refreshed).toBe(1);
		expect(result.current.streaming).toBe(false);
		expect(result.current.streamContent).toBe("");
	});

	it("does not start a second stream while one is in flight", async () => {
		// `streaming` is state and therefore stale within the tick that issued the
		// first send, so the guard also consults `abortControllerRef` — a ref, and
		// thus synchronously correct. Without it the second send would overwrite
		// that ref and orphan the first stream: it keeps reading and appending to
		// the transcript with nothing left able to abort it.
		mocks.csrfFetch.mockResolvedValue(sseResponse([{ type: "done" }]));
		const { args } = setup();
		const { result } = renderHook(() => useAiChatStream(args));
		await act(async () => {
			await Promise.all([result.current.sendMessage(sendArgs), result.current.sendMessage(sendArgs)]);
		});
		const chatCalls = mocks.csrfFetch.mock.calls.filter((c) => c[0] === "/api/ai/chat");
		expect(chatCalls).toHaveLength(1);
	});

	it("allows a new send after the previous stream finished", async () => {
		// The ref must be cleared in `finally`, or the guard above would wedge the
		// composer permanently after the first message.
		mocks.csrfFetch.mockImplementation(async (url: string) =>
			url === "/api/ai/chat"
				? sseResponse([{ type: "done" }])
				: { conversation: { messages: [] } },
		);
		const { args } = setup();
		const { result } = renderHook(() => useAiChatStream(args));
		await act(async () => { await result.current.sendMessage(sendArgs); });
		await act(async () => { await result.current.sendMessage(sendArgs); });
		const chatCalls = mocks.csrfFetch.mock.calls.filter((c) => c[0] === "/api/ai/chat");
		expect(chatCalls).toHaveLength(2);
	});

	it("allows a new send after stopGeneration cleared the in-flight stream", async () => {
		mocks.csrfFetch.mockImplementation(async (url: string) =>
			url === "/api/ai/chat"
				? sseResponse([{ type: "done" }])
				: { conversation: { messages: [] } },
		);
		const { args } = setup();
		const { result } = renderHook(() => useAiChatStream(args));
		await act(async () => { result.current.stopGeneration(); });
		await act(async () => { await result.current.sendMessage(sendArgs); });
		const chatCalls = mocks.csrfFetch.mock.calls.filter((c) => c[0] === "/api/ai/chat");
		expect(chatCalls).toHaveLength(1);
	});

	it("is a no-op with no active conversation", async () => {
		const { args } = setup(null);
		const { result } = renderHook(() => useAiChatStream(args));
		await act(async () => { await result.current.sendMessage(sendArgs); });
		expect(mocks.csrfFetch).not.toHaveBeenCalled();
	});

	describe("failures stay visible", () => {
		it("writes an error bubble and a toast for a non-ok HTTP response", async () => {
			// The stream bubble is unmounted by `finally`, so without an appended
			// message the failure would be entirely invisible.
			mocks.csrfFetch.mockResolvedValue({
				ok: false,
				json: async () => ({ error: "provider quota exceeded" }),
			} as unknown as Response);
			const { state, args } = setup();
			const { result } = renderHook(() => useAiChatStream(args));
			await act(async () => { await result.current.sendMessage(sendArgs); });
			expect(state.messages).toHaveLength(1);
			expect(state.messages[0]!.content).toBe("❌ provider quota exceeded");
			expect(state.toasts).toEqual([{ kind: "error", message: "provider quota exceeded" }]);
		});

		it("falls back to a generic message when the error body is unreadable", async () => {
			mocks.csrfFetch.mockResolvedValue({
				ok: false,
				json: async () => { throw new Error("not json"); },
			} as unknown as Response);
			const { state, args } = setup();
			const { result } = renderHook(() => useAiChatStream(args));
			await act(async () => { await result.current.sendMessage(sendArgs); });
			expect(state.messages[0]!.content).toBe("❌ aiPage.requestFailed");
		});

		it("surfaces an in-band error frame", async () => {
			mocks.csrfFetch.mockResolvedValue(
				sseResponse([{ type: "content", content: "partial" }, { type: "error", error: "upstream 502" }]),
			);
			const { state, args } = setup();
			const { result } = renderHook(() => useAiChatStream(args));
			await act(async () => { await result.current.sendMessage(sendArgs); });
			expect(state.messages[0]!.content).toBe("❌ upstream 502");
			expect(state.toasts).toEqual([{ kind: "error", message: "upstream 502" }]);
		});

		it("does not double-prefix an error that already carries the marker", async () => {
			mocks.csrfFetch.mockResolvedValue(sseResponse([{ type: "error", error: "❌ already marked" }]));
			const { state, args } = setup();
			const { result } = renderHook(() => useAiChatStream(args));
			await act(async () => { await result.current.sendMessage(sendArgs); });
			expect(state.messages[0]!.content).toBe("❌ already marked");
			// The toast strips the marker so it is not shown twice to the user.
			expect(state.toasts).toEqual([{ kind: "error", message: "already marked" }]);
		});

		it("reports a thrown network error", async () => {
			mocks.csrfFetch.mockRejectedValue(new TypeError("Failed to fetch"));
			const { state, args } = setup();
			const { result } = renderHook(() => useAiChatStream(args));
			await act(async () => { await result.current.sendMessage(sendArgs); });
			expect(state.messages[0]!.content).toBe("❌ aiPage.networkError");
		});

		it("treats a body-less response as a failure rather than a silent success", async () => {
			mocks.csrfFetch.mockResolvedValue({ ok: true, body: null } as unknown as Response);
			const { state, args } = setup();
			const { result } = renderHook(() => useAiChatStream(args));
			await act(async () => { await result.current.sendMessage(sendArgs); });
			expect(state.messages[0]!.content).toBe("❌ aiPage.requestFailed");
		});

		it("skips a malformed SSE frame instead of aborting the stream", async () => {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					const enc = new TextEncoder();
					controller.enqueue(enc.encode("data: {not json\n\n"));
					controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: "content", content: "ok" })}\n\n`));
					controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
					controller.close();
				},
			});
			mocks.csrfFetch.mockImplementation(async (url: string) =>
				url === "/api/ai/chat"
					? ({ ok: true, body } as unknown as Response)
					: { conversation: { messages: [{ id: "s1", content: "ok" }] } },
			);
			const { state, args } = setup();
			const { result } = renderHook(() => useAiChatStream(args));
			await act(async () => { await result.current.sendMessage(sendArgs); });
			expect(state.messages).toEqual([{ id: "s1", content: "ok" }]);
			expect(state.toasts).toHaveLength(0);
		});

		it("still refreshes the conversation list after a failure", async () => {
			mocks.csrfFetch.mockRejectedValue(new TypeError("Failed to fetch"));
			const { state, args } = setup();
			const { result } = renderHook(() => useAiChatStream(args));
			await act(async () => { await result.current.sendMessage(sendArgs); });
			expect(state.refreshed).toBe(1);
		});
	});

	describe("conversation pin", () => {
		/**
		 * `convIdAtSend` is compared against `activeConvIdRef` before every
		 * transcript write. These cases drive the hook with a *different* active
		 * conversation than the one the send started on, which is what happens when
		 * the user clicks another chat while a reply is streaming.
		 */
		it("drops the assistant reply when the user switched conversations mid-stream", async () => {
			// The switch has to land while the stream is open, and React must flush
			// the effect that updates `activeConvIdRef` — hence the deferred frame.
			let emitDone: (() => void) | undefined;
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					const enc = new TextEncoder();
					controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: "content", content: "for A" })}\n\n`));
					emitDone = () => {
						controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
						controller.close();
					};
				},
			});
			mocks.csrfFetch.mockImplementation(async (url: string) =>
				url === "/api/ai/chat"
					? ({ ok: true, body } as unknown as Response)
					: { conversation: { messages: [{ id: "conv_b_server_copy" }] } },
			);
			const { state, args } = setup("conv_a");
			const { result, rerender } = renderHook((props: typeof args) => useAiChatStream(props), {
				initialProps: args,
			});
			let sent: Promise<void> | undefined;
			await act(async () => { sent = result.current.sendMessage(sendArgs); });
			// Switching conversations aborts the in-flight stream via the effect.
			await act(async () => {
				rerender({ ...args, activeConvId: "conv_b", activeConv: { id: "conv_b", model: "m" } as never });
			});
			await act(async () => { emitDone?.(); await sent; });
			// Nothing may be written under the conversation that was left behind.
			for (const message of state.messages) {
				expect(message.conversationId).not.toBe("conv_a");
			}
		});

		it("drops the error bubble when the user switched conversations mid-stream", async () => {
			// An error written into the wrong chat is the same defect as a reply.
			let failStream: (() => void) | undefined;
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					failStream = () => controller.error(new Error("connection reset"));
				},
			});
			mocks.csrfFetch.mockImplementation(async (url: string) =>
				url === "/api/ai/chat"
					? ({ ok: true, body } as unknown as Response)
					: { conversation: { messages: [] } },
			);
			const { state, args } = setup("conv_a");
			const { result, rerender } = renderHook((props: typeof args) => useAiChatStream(props), {
				initialProps: args,
			});
			let sent: Promise<void> | undefined;
			await act(async () => { sent = result.current.sendMessage(sendArgs); });
			await act(async () => {
				rerender({ ...args, activeConvId: "conv_b", activeConv: { id: "conv_b", model: "m" } as never });
			});
			await act(async () => { failStream?.(); await sent; });
			for (const message of state.messages) {
				expect(message.conversationId).not.toBe("conv_a");
			}
			// The toast still fires — the user should know the send failed.
			expect(state.toasts.some((toast) => toast.kind === "error")).toBe(true);
		});

		it("clears ephemeral stream state when the conversation changes", async () => {
			const { args } = setup("conv_a");
			const { result, rerender } = renderHook((props: typeof args) => useAiChatStream(props), {
				initialProps: args,
			});
			act(() => {
				result.current.setPendingApprovals([
					{ actionId: "act_1", actionName: "restart", actionType: "restart_service", riskLevel: "high" } as never,
				]);
			});
			expect(result.current.pendingApprovals).toHaveLength(1);
			rerender({ ...args, activeConvId: "conv_b", activeConv: { id: "conv_b", model: "m" } as never });
			// Otherwise conversation A's pending approval buttons would sit in B's UI,
			// where confirming them would execute an action the user cannot see.
			expect(result.current.pendingApprovals).toEqual([]);
			expect(result.current.streamContent).toBe("");
			expect(result.current.streaming).toBe(false);
		});
	});

	describe("stopGeneration", () => {
		it("aborts and re-reads the server transcript so the partial reply is not lost", async () => {
			mocks.csrfFetch.mockResolvedValue({
				conversation: { messages: [{ id: "partial_1", content: "half a reply" }] },
			});
			const { state, args } = setup();
			const { result } = renderHook(() => useAiChatStream(args));
			await act(async () => { result.current.stopGeneration(); });
			expect(result.current.streaming).toBe(false);
			expect(state.messages).toEqual([{ id: "partial_1", content: "half a reply" }]);
		});

		it("warns when the post-stop refresh fails instead of failing silently", async () => {
			mocks.csrfFetch.mockRejectedValue(new Error("offline"));
			const { state, args } = setup();
			const { result } = renderHook(() => useAiChatStream(args));
			await act(async () => { result.current.stopGeneration(); });
			expect(state.toasts).toEqual([{ kind: "error", message: "aiPage.stopRefreshFailed" }]);
		});

		it("does not call the API when there is no active conversation", async () => {
			const { args } = setup(null);
			const { result } = renderHook(() => useAiChatStream(args));
			await act(async () => { result.current.stopGeneration(); });
			expect(mocks.csrfFetch).not.toHaveBeenCalled();
		});
	});

	describe("decideApproval", () => {
		const approval = {
			actionId: "act_1",
			actionName: "restart nginx",
			actionType: "restart_service",
			riskLevel: "high",
		} as never;

		it("confirms an action, drops it from the pending list, and re-reads the transcript", async () => {
			mocks.csrfFetch.mockImplementation(async (url: string) =>
				url.startsWith("/api/ai/hosted-actions/")
					? { ok: true }
					: { conversation: { messages: [{ id: "after_approve" }] } },
			);
			const { state, args } = setup();
			const { result } = renderHook(() => useAiChatStream(args));
			act(() => { result.current.setPendingApprovals([approval]); });
			await act(async () => { await result.current.decideApproval(approval, "confirm"); });
			expect(mocks.csrfFetch).toHaveBeenCalledWith(
				"/api/ai/hosted-actions/act_1",
				expect.objectContaining({ method: "PATCH", body: JSON.stringify({ action: "confirm" }) }),
			);
			expect(result.current.pendingApprovals).toEqual([]);
			expect(state.messages).toEqual([{ id: "after_approve" }]);
			expect(state.toasts.at(-1)).toMatchObject({ kind: "success" });
		});

		it("sends a reason when rejecting", async () => {
			mocks.csrfFetch.mockResolvedValue({ ok: true });
			const { args } = setup();
			const { result } = renderHook(() => useAiChatStream(args));
			await act(async () => { await result.current.decideApproval(approval, "reject"); });
			const body = JSON.parse(
				(mocks.csrfFetch.mock.calls.find((c) => String(c[0]).includes("hosted-actions"))![1] as { body: string }).body,
			);
			expect(body).toEqual({ action: "reject", reason: "aiPage.userDenied" });
		});

		it("ignores a duplicate decision for the same action id", async () => {
			// Double-clicking Approve must not execute a privileged action twice.
			let release: (() => void) | undefined;
			mocks.csrfFetch.mockImplementation((url: string) =>
				url.startsWith("/api/ai/hosted-actions/")
					? new Promise((resolve) => { release = () => resolve({ ok: true }); })
					: Promise.resolve({ conversation: { messages: [] } }),
			);
			const { args } = setup();
			const { result } = renderHook(() => useAiChatStream(args));
			let first: Promise<void> | undefined;
			await act(async () => {
				first = result.current.decideApproval(approval, "confirm");
				await result.current.decideApproval(approval, "confirm");
			});
			const patchCalls = mocks.csrfFetch.mock.calls.filter((c) => String(c[0]).includes("hosted-actions"));
			expect(patchCalls).toHaveLength(1);
			await act(async () => { release?.(); await first; });
		});

		it("clears the busy flag and toasts on failure so the button is not stuck", async () => {
			mocks.csrfFetch.mockRejectedValue(new Error("action already executed"));
			const { state, args } = setup();
			const { result } = renderHook(() => useAiChatStream(args));
			await act(async () => { await result.current.decideApproval(approval, "confirm"); });
			expect(result.current.approvalBusyById).toEqual({});
			expect(state.toasts.at(-1)).toMatchObject({ kind: "error" });
		});
	});
});
