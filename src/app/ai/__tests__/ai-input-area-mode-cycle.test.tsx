import { fireEvent, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { AiInputArea } from "../ai-input-area";
import type { ConvItem } from "../ai-types";
import type { UseFileAttachmentsReturn } from "../hooks/use-file-attachments";

const conv: ConvItem = {
	id: "conv-1", title: "t", providerId: "p", model: "gpt-4o-mini", systemPrompt: null, temperature: 0.7, maxTokens: 4096,
	topP: 1, frequencyPenalty: 0, presencePenalty: 0, enableVision: false, hostingEnabled: true, automationMode: "ASSISTED",
	createdBy: "u", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
	provider: { id: "p", name: "OpenAI", type: "OPENAI_COMPATIBLE" },
};

const attachments: UseFileAttachmentsReturn = {
	fileAttachments: [],
	fileRejectionMsg: null,
	clearRejection: vi.fn(),
	handleFileSelect: vi.fn(),
	handlePaste: vi.fn(),
	handleDrop: vi.fn(),
	handleDragOver: vi.fn(),
	clearAttachments: vi.fn(),
	setFileAttachments: vi.fn(),
};

function renderComposer(props: Partial<Parameters<typeof AiInputArea>[0]> = {}) {
	return render(
		<AiInputArea
			input=""
			setInput={vi.fn()}
			streaming={false}
			activeConv={conv}
			currentModelCaps={{ vision: false, document: false, video: false, audio: false }}
			textareaRef={createRef<HTMLTextAreaElement>()}
			fileInputRef={createRef<HTMLInputElement>()}
			fileAttachmentsState={attachments}
			handleSend={vi.fn()}
			handleStopGeneration={vi.fn()}
			{...props}
		/>,
	);
}

/** Shift+Tab in the message box cycles the working mode, as in a terminal assistant; otherwise it moves focus. */
describe("AiInputArea working mode shortcut", () => {
	it("cycles the mode on Shift+Tab and keeps the focus in the message box", () => {
		const onCycleMode = vi.fn(() => true);
		renderComposer({ onCycleMode });
		const textarea = screen.getByRole("textbox", { name: "消息输入" });
		expect(textarea).toHaveAttribute("aria-keyshortcuts", "Shift+Tab");
		const event = fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
		expect(onCycleMode).toHaveBeenCalledOnce();
		// fireEvent returns false when the default action was prevented.
		expect(event).toBe(false);
	});

	it("lets Shift+Tab move focus as usual when the mode does not change", () => {
		const onCycleMode = vi.fn(() => false);
		renderComposer({ onCycleMode });
		const event = fireEvent.keyDown(screen.getByRole("textbox", { name: "消息输入" }), { key: "Tab", shiftKey: true });
		expect(onCycleMode).toHaveBeenCalledOnce();
		expect(event).toBe(true);
	});

	it("ignores Tab without Shift, Ctrl+Shift+Tab, and keys typed during IME composition", () => {
		const onCycleMode = vi.fn(() => true);
		renderComposer({ onCycleMode });
		const textarea = screen.getByRole("textbox", { name: "消息输入" });
		fireEvent.keyDown(textarea, { key: "Tab" });
		fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true, ctrlKey: true });
		fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true, isComposing: true });
		expect(onCycleMode).not.toHaveBeenCalled();
	});

	it("draws the toolbar (pins and mode switcher) above the message box", () => {
		renderComposer({ toolbar: <div data-testid="composer-toolbar">toolbar</div> });
		expect(screen.getByTestId("composer-toolbar")).toBeInTheDocument();
		expect(screen.getByRole("textbox", { name: "消息输入" })).not.toHaveAttribute("aria-keyshortcuts");
	});
});
