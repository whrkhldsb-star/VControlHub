import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({ mocks: { csrfFetch: vi.fn(), refresh: vi.fn() } }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: mocks.csrfFetch }));

import { RetentionButton } from "../retention-button";

describe("RetentionButton", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.csrfFetch.mockResolvedValue({ taskId: "job:1" });
	});

	it("says what will be deleted and waits for a second press before deleting backups", async () => {
		// It used to delete backup files and records on the first click (or an Enter in a number box).
		render(<RetentionButton olderThan30Days={4} totalRecords={9} />);
		fireEvent.change(screen.getAllByRole("spinbutton")[0]!, { target: { value: "7" } });
		fireEvent.change(screen.getAllByRole("spinbutton")[1]!, { target: { value: "0" } });

		fireEvent.click(screen.getByRole("button", { name: "立即清理" }));
		expect(mocks.csrfFetch).not.toHaveBeenCalled();
		expect(screen.getByRole("alert")).toHaveTextContent("超过 7 天");
		expect(screen.getByRole("alert")).toHaveTextContent("最新 0 份");

		fireEvent.click(screen.getByRole("button", { name: "确认清理" }));
		await waitFor(() => expect(mocks.csrfFetch).toHaveBeenCalledWith("/api/backups/retention", expect.objectContaining({ method: "POST" })));
		expect(JSON.parse(mocks.csrfFetch.mock.calls[0]![1]!.body)).toEqual({ olderThanDays: 7, keepLatestPerType: 0 });
	});

	it("asks again when the settings change, and lets the operator back out", () => {
		render(<RetentionButton olderThan30Days={4} totalRecords={9} />);
		fireEvent.click(screen.getByRole("button", { name: "立即清理" }));
		expect(screen.getByRole("button", { name: "确认清理" })).toBeInTheDocument();

		fireEvent.change(screen.getAllByRole("spinbutton")[0]!, { target: { value: "3" } });
		expect(screen.queryByRole("button", { name: "确认清理" })).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "立即清理" }));
		fireEvent.click(screen.getByRole("button", { name: /取消/ }));
		expect(screen.queryByRole("button", { name: "确认清理" })).not.toBeInTheDocument();
		expect(mocks.csrfFetch).not.toHaveBeenCalled();
	});
});
