// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const copyText = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ui/clipboard", () => ({ copyText }));

import { renderContent } from "../ai-markdown-renderer";
import { AiCopyButton } from "../ai-copy-button";

/**
 * The copy button of a code block copied and said nothing: the same click on a page where the browser
 * refuses the clipboard looked exactly like one that worked. The message's own button said "copied" and
 * was silent on a refusal.
 */
const labels = { label: "复制", copiedLabel: "已复制", failedLabel: "复制失败，请手动选中复制" };

describe("AiCopyButton", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		copyText.mockReset();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	const press = async (name: string | RegExp) => {
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name }));
		});
	};

	it("says that it copied, and goes back to its label", async () => {
		copyText.mockResolvedValue(true);
		render(<AiCopyButton text="df -h" {...labels} />);
		await press("复制");
		expect(copyText).toHaveBeenCalledWith("df -h");
		expect(screen.getByRole("button")).toHaveTextContent("已复制");
		act(() => {
			vi.advanceTimersByTime(2000);
		});
		expect(screen.getByRole("button")).toHaveTextContent(/^复制$/);
	});

	it("says that it could not copy", async () => {
		copyText.mockResolvedValue(false);
		render(<AiCopyButton text="df -h" {...labels} />);
		await press("复制");
		expect(screen.getByRole("button")).toHaveTextContent("复制失败，请手动选中复制");
		expect(screen.getByRole("button")).toHaveAttribute("data-copy-outcome", "failed");
	});

	it("is named by what it copies until it has something to report", async () => {
		copyText.mockResolvedValue(true);
		render(<AiCopyButton text="hello" ariaLabel="复制消息" {...labels} />);
		await press("复制消息");
		expect(screen.getByRole("button")).toHaveAccessibleName("已复制");
	});

	it("is the copy button of a code block", async () => {
		copyText.mockResolvedValue(true);
		render(<div>{renderContent("```bash\nls -la\n```", { copy: labels })}</div>);
		await press("复制");
		expect(copyText).toHaveBeenCalledWith("ls -la\n");
		expect(screen.getByRole("button")).toHaveTextContent("已复制");
	});
});
