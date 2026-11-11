import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

import { AiAttachmentsPreview } from "../ai-attachments-preview";
import { AiRenameDialog } from "../ai-rename-dialog";

/**
 * The Enter that picks a candidate of an input method (Chinese, Japanese…) is text, not a command. Browsers mark
 * it with `isComposing`, older engines with keyCode 229.
 */
function enter(target: Element, how: "plain" | "composing" | "legacy") {
	const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
	if (how === "composing") Object.defineProperty(event, "isComposing", { value: true });
	if (how === "legacy") Object.defineProperty(event, "keyCode", { value: 229 });
	fireEvent(target, event);
}

describe("Enter while an input method is composing", () => {
	it("does not save a conversation title that is still being typed", () => {
		const onConfirm = vi.fn();
		render(<AiRenameDialog open title="部署" busy={false} error={null} onChangeTitle={vi.fn()} onCancel={vi.fn()} onConfirm={onConfirm} />);
		const input = screen.getByRole("textbox", { name: "新标题" });

		enter(input, "composing");
		enter(input, "legacy");
		expect(onConfirm).not.toHaveBeenCalled();

		enter(input, "plain");
		expect(onConfirm).toHaveBeenCalledOnce();
	});

	it("does not add an image address that is still being typed", () => {
		const setImageUrls = vi.fn();
		render(
			<AiAttachmentsPreview
				enableVision
				imageUrls={[]}
				setImageUrls={setImageUrls}
				imageUrlInput="https://example.com/a.png"
				setImageUrlInput={vi.fn()}
				fileAttachments={[]}
				setFileAttachments={vi.fn()}
			/>,
		);
		const input = screen.getByRole("textbox");

		enter(input, "composing");
		enter(input, "legacy");
		expect(setImageUrls).not.toHaveBeenCalled();

		enter(input, "plain");
		expect(setImageUrls).toHaveBeenCalledOnce();
	});
});
