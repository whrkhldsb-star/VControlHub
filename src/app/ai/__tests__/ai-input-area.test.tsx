import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";

import { AiInputArea } from "../ai-input-area";
import type { ConvItem, ModelCapabilities, FileAttachment } from "../ai-types";
import type { UseFileAttachmentsReturn } from "../hooks/use-file-attachments";

const baseConv: ConvItem = {
	id: "conv-1",
	title: "测试",
	providerId: "provider-1",
	model: "gpt-4o-mini",
	systemPrompt: null,
	temperature: 0.7,
	maxTokens: 4096,
	topP: 1,
	frequencyPenalty: 0,
	presencePenalty: 0,
	enableVision: false,
	hostingEnabled: false,
	createdBy: "user-1",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	provider: { id: "provider-1", name: "OpenAI", type: "OPENAI_COMPATIBLE" },
};

const baseCaps: ModelCapabilities = {
	vision: false,
	video: false,
	audio: false,
	document: false,
};

function makeFileAttachmentState(
	overrides: Partial<UseFileAttachmentsReturn> = {}
): UseFileAttachmentsReturn {
	return {
		fileAttachments: [],
		fileRejectionMsg: null,
		clearRejection: vi.fn(),
		handleFileSelect: vi.fn(),
		handlePaste: vi.fn(),
		handleDrop: vi.fn(),
		handleDragOver: vi.fn(),
		clearAttachments: vi.fn(),
		setFileAttachments: vi.fn(),
		...overrides,
	};
}

describe("AiInputArea", () => {
	it("renders the textarea, send button, and disabled state while streaming is false", () => {
		const setInput = vi.fn();
		const handleSend = vi.fn();
		const handleStop = vi.fn();
		render(
			<AiInputArea
				input=""
				setInput={setInput}
				streaming={false}
				activeConv={baseConv}
				currentModelCaps={baseCaps}
				textareaRef={createRef<HTMLTextAreaElement>()}
				fileInputRef={createRef<HTMLInputElement>()}
				fileAttachmentsState={makeFileAttachmentState()}
				handleSend={handleSend}
				handleStopGeneration={handleStop}
			/>
		);
		const textarea = screen.getByRole("textbox", { name: "消息输入" });
		expect(textarea).toBeInTheDocument();
		// Send button is disabled when input is empty and no attachments
		const sendButton = screen.getByRole("button", { name: "" });
		expect(sendButton).toBeDisabled();
		// Stop button is hidden while not streaming
		expect(screen.queryByTitle("停止生成")).not.toBeInTheDocument();
	});

	it("forwards textarea typing to setInput and submit-on-Enter to handleSend", async () => {
		const user = userEvent.setup();
		const setInput = vi.fn();
		const handleSend = vi.fn();
		render(
			<AiInputArea
				input="hi"
				setInput={setInput}
				streaming={false}
				activeConv={baseConv}
				currentModelCaps={baseCaps}
				textareaRef={createRef<HTMLTextAreaElement>()}
				fileInputRef={createRef<HTMLInputElement>()}
				fileAttachmentsState={makeFileAttachmentState()}
				handleSend={handleSend}
				handleStopGeneration={vi.fn()}
			/>
		);
		const textarea = screen.getByRole("textbox", { name: "消息输入" });
		await user.type(textarea, "x");
		expect(setInput).toHaveBeenCalled();
		await user.keyboard("{Enter}");
		expect(handleSend).toHaveBeenCalledTimes(1);
	});

	it("does not submit on Shift+Enter and surfaces the stop button while streaming", async () => {
		const user = userEvent.setup();
		const handleSend = vi.fn();
		const handleStop = vi.fn();
		render(
			<AiInputArea
				input="hi"
				setInput={vi.fn()}
				streaming={true}
				activeConv={baseConv}
				currentModelCaps={baseCaps}
				textareaRef={createRef<HTMLTextAreaElement>()}
				fileInputRef={createRef<HTMLInputElement>()}
				fileAttachmentsState={makeFileAttachmentState()}
				handleSend={handleSend}
				handleStopGeneration={handleStop}
			/>
		);
		const textarea = screen.getByRole("textbox", { name: "消息输入" });
		await user.click(textarea);
		await user.keyboard("{Shift>}{Enter}{/Shift}");
		expect(handleSend).not.toHaveBeenCalled();
		const stopButton = screen.getByTitle("停止生成");
		expect(stopButton).toBeInTheDocument();
		await user.click(stopButton);
		expect(handleStop).toHaveBeenCalledTimes(1);
	});

	it("enables the send button when input has text even with no attachments", () => {
		render(
			<AiInputArea
				input="hello"
				setInput={vi.fn()}
				streaming={false}
				activeConv={baseConv}
				currentModelCaps={baseCaps}
				textareaRef={createRef<HTMLTextAreaElement>()}
				fileInputRef={createRef<HTMLInputElement>()}
				fileAttachmentsState={makeFileAttachmentState()}
				handleSend={vi.fn()}
				handleStopGeneration={vi.fn()}
			/>
		);
		const sendButton = screen.getByRole("button", { name: "" });
		expect(sendButton).not.toBeDisabled();
	});

	it("shows the file rejection toast and calls clearRejection when dismissed", async () => {
		const user = userEvent.setup();
		const clearRejection = vi.fn();
		const attachment: FileAttachment = {
			name: "tiny.txt",
			content: "data",
			type: "text",
			mimeType: "text/plain",
		};
		render(
			<AiInputArea
				input=""
				setInput={vi.fn()}
				streaming={false}
				activeConv={baseConv}
				currentModelCaps={baseCaps}
				textareaRef={createRef<HTMLTextAreaElement>()}
				fileInputRef={createRef<HTMLInputElement>()}
				fileAttachmentsState={makeFileAttachmentState({
					fileRejectionMsg: "📄 太大",
					clearRejection,
					fileAttachments: [attachment],
				})}
				handleSend={vi.fn()}
				handleStopGeneration={vi.fn()}
			/>
		);
		expect(screen.getByText("📄 太大")).toBeInTheDocument();
		const dismissButton = screen.getByRole("button", { name: "×" });
		await user.click(dismissButton);
		expect(clearRejection).toHaveBeenCalledTimes(1);
	});

	it("switches the placeholder when enableVision is true", () => {
		const visionConv: ConvItem = { ...baseConv, enableVision: true };
		const visionCaps: ModelCapabilities = { ...baseCaps, vision: true };
		render(
			<AiInputArea
				input=""
				setInput={vi.fn()}
				streaming={false}
				activeConv={visionConv}
				currentModelCaps={visionCaps}
				textareaRef={createRef<HTMLTextAreaElement>()}
				fileInputRef={createRef<HTMLInputElement>()}
				fileAttachmentsState={makeFileAttachmentState()}
				handleSend={vi.fn()}
				handleStopGeneration={vi.fn()}
			/>
		);
		const textarea = screen.getByRole("textbox", { name: "消息输入" });
		expect(textarea.getAttribute("placeholder")).toMatch(/支持/);
	});
});
