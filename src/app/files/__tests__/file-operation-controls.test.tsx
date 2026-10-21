import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: mocks.fetch }));
vi.mock("@/components/toast-provider", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/components/toast-provider")>()),
	useToast: () => ({ addToast: mocks.toast }),
}));

import { FileOperationTasks, submitFileOperation } from "../file-operation-controls";

const job = (status: string, extra: Record<string, unknown> = {}) => ({
	id: "job_1", title: "move", action: "move", count: 2, status, progress: null, errorMessage: null, ...extra,
});

function renderTasks() {
	return renderWithI18n(
		<FileOperationTasks trigger={({ active, open }) => <button type="button" onClick={open}>tasks {active}</button>} />,
	);
}

describe("FileOperationTasks", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mocks.fetch.mockReset();
		mocks.toast.mockReset();
	});
	afterEach(() => vi.useRealTimers());

	it("stays quiet until a job is submitted, then reports it without opening the list", async () => {
		mocks.fetch
			.mockResolvedValueOnce({ id: "job_1" })
			.mockResolvedValueOnce({ jobs: [job("RUNNING")] })
			.mockResolvedValueOnce({ jobs: [job("COMPLETED", { result: { items: [{ id: "a", state: "success" }, { id: "b", state: "success" }] } })] });
		renderTasks();
		expect(mocks.fetch).not.toHaveBeenCalled();
		const completed = vi.fn();
		window.addEventListener("file-operation-completed", completed);

		await act(async () => {
			await submitFileOperation({ action: "move", fileEntryIds: ["a", "b"], targetDir: "docs", policy: "skip" });
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(screen.getByRole("button", { name: "tasks 1" })).toBeInTheDocument();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2600);
		});
		expect(mocks.toast).toHaveBeenCalledWith("success", "移动 2 项已完成");
		expect(completed).toHaveBeenCalledOnce();
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		window.removeEventListener("file-operation-completed", completed);
	});

	it("warns when a watched job finished with failed items, even if it finished before the first poll", async () => {
		mocks.fetch
			.mockResolvedValueOnce({ id: "job_1" })
			.mockResolvedValueOnce({ jobs: [job("COMPLETED", { result: { items: [{ id: "a", state: "error", error: "exists" }] } })] });
		renderTasks();
		await act(async () => {
			await submitFileOperation({ action: "move", fileEntryIds: ["a", "b"], targetDir: "docs", policy: "skip" });
		});
		expect(mocks.toast).toHaveBeenCalledWith("warning", expect.stringContaining("未全部完成"));
	});

	it("does not toast old history and opens the list on request", async () => {
		mocks.fetch.mockResolvedValue({ jobs: [job("FAILED", { id: "old" })] });
		renderTasks();
		fireEvent.click(screen.getByRole("button", { name: "tasks 0" }));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10);
		});
		expect(screen.getByRole("dialog", { name: "文件任务" })).toBeVisible();
		expect(mocks.toast).not.toHaveBeenCalled();
	});
});
