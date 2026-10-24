import { createRef } from "react";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { AiMessageList } from "../ai-message-list";

/**
 * A model that thinks before it answers streams reasoning first. With
 * reasoning and no answer text yet, the reply bubble needed text and the
 * waiting hint needed no reasoning: the thinking was hidden, and so was the hint.
 */
describe("AiMessageList while streaming", () => {
	const base = {
		messages: [],
		pendingApprovals: [],
		approvalBusyById: {},
		onApproval: vi.fn(),
		copyFeedback: null,
		setCopyFeedback: vi.fn(),
		currentModelCaps: {} as never,
		messagesEndRef: createRef<HTMLDivElement>(),
		onDrop: vi.fn(),
		onDragOver: vi.fn(),
	};

	it("shows the reasoning before any answer text arrives", () => {
		render(<AiMessageList {...base} streaming streamContent="" streamReasoning="Checking the disk first." />);
		expect(screen.getByText("Checking the disk first.")).toBeVisible();
	});

	it("shows the waiting hint while nothing has arrived", () => {
		render(<AiMessageList {...base} streaming streamContent="" streamReasoning="" />);
		expect(screen.getByText(/思考|Thinking/)).toBeInTheDocument();
	});
});
