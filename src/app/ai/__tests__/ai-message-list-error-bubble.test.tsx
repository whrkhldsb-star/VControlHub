import { createRef } from "react";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { AiMessageList } from "../ai-message-list";
import { streamErrorMessage } from "../ai-stream-error";
import type { Message } from "../ai-types";

/**
 * A request that fails leaves a reply saying so. The transcript told such a reply by a "⚠" at its start while
 * the stream wrote "❌": it was drawn as an ordinary answer, and its button offered to regenerate instead of to
 * try again.
 */
describe("AiMessageList and a failed reply", () => {
	const base = {
		pendingApprovals: [],
		approvalBusyById: {},
		onApproval: vi.fn(),
		copyFeedback: null,
		setCopyFeedback: vi.fn(),
		currentModelCaps: {} as never,
		messagesEndRef: createRef<HTMLDivElement>(),
		onDrop: vi.fn(),
		onDragOver: vi.fn(),
		streaming: false,
		streamContent: "",
		streamReasoning: "",
	};
	const question: Message = {
		id: "m1", conversationId: "c1", role: "user", content: "磁盘还剩多少？", reasoningContent: null, imageUrls: "[]",
		model: null, inputTokens: null, outputTokens: null, latencyMs: null, createdAt: "2026-11-11T08:00:00.000Z",
	};

	it("offers to try again after the reply the stream writes for a failed request", () => {
		const failed = streamErrorMessage({ conversationId: "c1", text: "provider quota exceeded", model: "gpt-4o" });
		render(<AiMessageList {...base} messages={[question, failed]} onRegenerate={vi.fn()} />);

		expect(screen.getByText(/provider quota exceeded/)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "重新生成" })).not.toBeInTheDocument();
		expect(screen.getByText(/provider quota exceeded/).closest("[data-error-reply]")).not.toBeNull();
	});

	it("still offers to regenerate an ordinary answer", () => {
		const answer: Message = { ...question, id: "m2", role: "assistant", content: "还剩 41 GB。" };
		render(<AiMessageList {...base} messages={[question, answer]} onRegenerate={vi.fn()} />);

		expect(screen.getByRole("button", { name: "重新生成" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
		expect(screen.getByText("还剩 41 GB。").closest("[data-error-reply]")).toBeNull();
	});

	it("does not take an answer that begins with a cross mark for a failure", () => {
		const answer: Message = { ...question, id: "m3", role: "assistant", content: "❌ 表示未通过，✅ 表示通过。" };
		render(<AiMessageList {...base} messages={[question, answer]} onRegenerate={vi.fn()} />);

		expect(screen.getByRole("button", { name: "重新生成" })).toBeInTheDocument();
	});
});
