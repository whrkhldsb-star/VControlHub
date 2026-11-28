import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToastFn } from "@/components/toast-provider";

const mocks = vi.hoisted(() => ({ csrfFetch: vi.fn() }));
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: mocks.csrfFetch }));
vi.mock("@/lib/i18n/use-locale", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import { type ToolExecutionEvent, useAiChatStream } from "../hooks/use-ai-chat-stream";

/** A streaming Response whose body sends these raw SSE chunks (frames, comments, anything). */
function rawSse(chunks: string[], init: { ok?: boolean; status?: number } = {}) {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	});
	return { ok: init.ok ?? true, status: init.status ?? 200, body, headers: new Headers(), json: async () => ({}) } as unknown as Response;
}
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;

function setup() {
	const state = { messages: [] as Array<Record<string, unknown>>, toasts: [] as Array<{ kind: string; message: string }> };
	const onToolExecution = vi.fn<(event: ToolExecutionEvent) => void>();
	const onStreamEnd = vi.fn();
	const args = {
		activeConv: { id: "conv_a", model: "m" } as never,
		activeConvId: "conv_a",
		setMessages: ((next: unknown) => {
			state.messages = typeof next === "function" ? (next as (p: unknown[]) => Array<Record<string, unknown>>)(state.messages) : (next as Array<Record<string, unknown>>);
		}) as never,
		refreshConversations: vi.fn(),
		addToast: ((kind, message) => { state.toasts.push({ kind, message }); }) satisfies ToastFn,
		onToolExecution,
		onStreamEnd,
	};
	const hook = renderHook(() => useAiChatStream(args));
	return { ...hook, state, onToolExecution, onStreamEnd };
}

const approval = { toolCallId: "tc-1", actionId: "act-1", actionName: "Execute command", actionType: "execute_command", riskLevel: "critical", params: { command: "rm -rf /tmp/x" } };
const patchBody = () => JSON.parse(mocks.csrfFetch.mock.calls.find(([url]) => String(url).startsWith("/api/ai/hosted-actions/"))![1].body);

describe("useAiChatStream (R19)", () => {
	beforeEach(() => {
		mocks.csrfFetch.mockReset();
	});

	describe("confirming a card", () => {
		it("sends the edited command and the critical acknowledgement", async () => {
			mocks.csrfFetch.mockResolvedValueOnce({ accepted: true, executedInline: true, requiresApproval: false, commandRequestId: "cmd-1", success: true, action: { status: "EXECUTING" } })
				.mockResolvedValueOnce({ conversation: { messages: [] } });
			const { result } = setup();
			let outcome: unknown;
			await act(async () => { outcome = await result.current.decideApproval(approval, "confirm", { editedCommand: "rm -rf /tmp/y", acknowledgeCritical: true }); });
			expect(patchBody()).toEqual({ action: "confirm", editedCommand: "rm -rf /tmp/y", acknowledgeCritical: true });
			// It runs now: the page follows it here (never a bounce to /requests).
			expect(outcome).toEqual({ kind: "executing", actionId: "act-1", conversationId: "conv_a", commandRequestId: "cmd-1" });
			expect(result.current.decidedActionIds.has("act-1")).toBe(true);
		});

		it("reports a peer-review receipt, not a run, when another reviewer must approve", async () => {
			mocks.csrfFetch.mockResolvedValueOnce({ accepted: true, executedInline: false, requiresApproval: true, commandRequestId: "cmd-9", success: true, action: { status: "APPROVED" } })
				.mockResolvedValueOnce({ conversation: { messages: [] } });
			const { result, state } = setup();
			let outcome: unknown;
			await act(async () => { outcome = await result.current.decideApproval(approval, "confirm"); });
			expect(patchBody()).toEqual({ action: "confirm" });
			expect(outcome).toEqual({ kind: "review", actionId: "act-1", conversationId: "conv_a", commandRequestId: "cmd-9" });
			expect(state.toasts).toEqual([{ kind: "success", message: "aiPage.live.sentForReviewToast" }]);
		});

		it("does not mark a refused decision as decided", async () => {
			mocks.csrfFetch.mockRejectedValueOnce(new Error("no permission"));
			const { result } = setup();
			let outcome: unknown;
			await act(async () => { outcome = await result.current.decideApproval(approval, "confirm"); });
			expect(outcome).toMatchObject({ kind: "failed" });
			expect(result.current.decidedActionIds.has("act-1")).toBe(false);
		});
	});

	describe("the live tool timeline", () => {
		it("keeps what each tool call returned, and the automatic runs with their risk", async () => {
			let controller!: ReadableStreamDefaultController<Uint8Array>;
			const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
			const encoder = new TextEncoder();
			const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
			mocks.csrfFetch.mockImplementation(async (url: string) =>
				url === "/api/ai/chat" ? ({ ok: true, body, headers: new Headers() } as unknown as Response) : { conversation: { messages: [] } });
			const { result, onToolExecution } = setup();
			let sending: Promise<void> = Promise.resolve();
			await act(async () => {
				sending = result.current.sendMessage({ content: "hi", imageUrls: [], imageBase64: [], fileAttachments: [] });
				send(frame({ type: "tool_call", toolCall: { id: "c1", name: "list_servers", args: {}, riskLevel: "low", autoApproved: true, actionName: "List servers", actionType: "list_servers" } }));
				send(frame({ type: "tool_result", toolCallId: "c1", success: true, actionId: "a1", data: { servers: [{ id: 1 }, { id: 2 }] } }));
				send(frame({ type: "tool_call", toolCall: { id: "c2", name: "execute_command", args: {}, riskLevel: "medium", autoApproved: false, actionName: "Execute command", actionType: "execute_command" } }));
				send(frame({ type: "tool_execution", toolCallId: "c2", actionId: "a2", commandRequestId: "cmd-2", phase: "running", effectiveRisk: "medium", decisionSource: "AI_MODE_AUTO" }));
				// Keep-alive while the command runs: a comment and a heartbeat frame change nothing.
				send(": keepalive\n\n");
				send(frame({ type: "heartbeat" }));
				send(frame({ type: "tool_execution", toolCallId: "c2", actionId: "a2", commandRequestId: "cmd-2", phase: "completed", exitCode: 0 }));
				send(frame({ type: "tool_result", toolCallId: "c2", success: true, actionId: "a2", data: { success: true, exitCode: 0, stdout: "up 3 days", stderr: "" } }));
				send(frame({ type: "tool_execution", toolCallId: "c3", actionId: "a3", commandRequestId: "cmd-3", phase: "timeout" }));
				send(frame({ type: "content", content: "Done." }));
				await new Promise((resolve) => setTimeout(resolve, 20));
			});
			expect(result.current.streaming).toBe(true);
			expect(result.current.streamContent).toBe("Done.");
			expect(result.current.streamSteps).toEqual([
				{ toolCallId: "c1", actionType: "list_servers", name: "List servers", state: "succeeded", riskLevel: "low", actionId: "a1", resultCount: 2, output: expect.stringContaining("servers") },
				{ toolCallId: "c2", actionType: "execute_command", name: "Execute command", state: "succeeded", riskLevel: "medium", auto: true, phase: "completed", actionId: "a2", commandRequestId: "cmd-2", decisionSource: "AI_MODE_AUTO", exitCode: 0, output: "up 3 days" },
				{ toolCallId: "c3", name: null, state: "running", auto: true, phase: "timeout", actionId: "a3", commandRequestId: "cmd-3" },
			]);
			expect(onToolExecution.mock.calls.map(([event]) => [event.actionId, event.phase])).toEqual([["a2", "running"], ["a2", "completed"], ["a3", "timeout"]]);
			await act(async () => {
				send(frame({ type: "done" }));
				controller.close();
				await sending;
			});
			expect(result.current.streamSteps).toEqual([]);
		});

		it("reads a last frame that arrived without its blank line", async () => {
			mocks.csrfFetch.mockImplementation(async (url: string) =>
				url === "/api/ai/chat" ? rawSse([frame({ type: "content", content: "ok" }), `data: ${JSON.stringify({ type: "done" })}`]) : { conversation: { messages: [{ id: "s1" }] } });
			const { result, state } = setup();
			await act(async () => { await result.current.sendMessage({ content: "hi", imageUrls: [], imageBase64: [], fileAttachments: [] }); });
			expect(state.messages).toEqual([{ id: "s1" }]);
			expect(state.toasts).toEqual([]);
		});
	});

	describe("continueConversation", () => {
		it("resumes the answer through POST …/continue without writing a user message", async () => {
			mocks.csrfFetch.mockImplementation(async (url: string) => {
				if (url === "/api/ai/conversations/conv_a/continue") return rawSse([frame({ type: "content", content: "The disk is fine." }), frame({ type: "done" })]);
				return { conversation: { messages: [{ id: "server-copy", role: "assistant" }] } };
			});
			const { result, state, onStreamEnd } = setup();
			let started = false;
			await act(async () => { started = await result.current.continueConversation(); });
			expect(started).toBe(true);
			const [, init] = mocks.csrfFetch.mock.calls.find(([url]) => url === "/api/ai/conversations/conv_a/continue")!;
			expect(init).toMatchObject({ method: "POST", raw: true });
			expect(mocks.csrfFetch.mock.calls.some(([url]) => url === "/api/ai/chat")).toBe(false);
			// The server's transcript replaces the streamed reply; nothing was added for the user.
			expect(state.messages).toEqual([{ id: "server-copy", role: "assistant" }]);
			expect(onStreamEnd).toHaveBeenCalledWith({ conversationId: "conv_a", kind: "continue", outcome: "done" });
		});

		it("says the assistant cannot continue yet when an action is still open (409), without an error bubble", async () => {
			mocks.csrfFetch.mockResolvedValueOnce(rawSse([], { ok: false, status: 409 }));
			const { result, state } = setup();
			await act(async () => { await result.current.continueConversation(); });
			expect(state.messages).toEqual([]);
			expect(state.toasts).toEqual([{ kind: "info", message: "aiPage.continue.busy" }]);
		});

		it("retries a failed continuation as a continuation", async () => {
			mocks.csrfFetch.mockResolvedValueOnce(rawSse([frame({ type: "error", error: "provider down" })]));
			const { result, state } = setup();
			await act(async () => { await result.current.continueConversation(); });
			const bubble = state.messages.at(-1)!;
			expect(bubble.content).toBe("provider down");
			mocks.csrfFetch.mockReset();
			mocks.csrfFetch.mockImplementation(async (url: string) =>
				url.endsWith("/continue") ? rawSse([frame({ type: "done" })]) : { conversation: { messages: [] } });
			await act(async () => { await result.current.retryFailedMessage(String(bubble.id)); });
			expect(mocks.csrfFetch.mock.calls[0]![0]).toBe("/api/ai/conversations/conv_a/continue");
		});

		it("does not start while another stream is open", async () => {
			let release!: (value: Response) => void;
			mocks.csrfFetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
			const { result } = setup();
			let first!: Promise<boolean>;
			let second = true;
			await act(async () => {
				first = result.current.continueConversation();
				second = await result.current.continueConversation();
			});
			expect(second).toBe(false);
			mocks.csrfFetch.mockResolvedValue({ conversation: { messages: [] } });
			await act(async () => { release(rawSse([frame({ type: "done" })])); await first; });
			expect(mocks.csrfFetch.mock.calls.filter(([url]) => String(url).endsWith("/continue"))).toHaveLength(1);
		});
	});
});
