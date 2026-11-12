import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";

const state = vi.hoisted(() => ({ items: [] as Array<Record<string, unknown>>, clearFinished: vi.fn() }));
vi.mock("../storage-upload-queue", () => ({
	StorageUploadQueue: class {
		subscribe = () => () => undefined;
		getSnapshot = () => state.items;
		dispose() {}
		clearFinished = state.clearFinished;
		pause = vi.fn();
		resume = vi.fn();
		cancel = vi.fn();
		isSettling = () => false;
	},
}));

import { StorageUploadStatus } from "../storage-upload-provider";

const item = (id: string, uploadState: string, percent = 0) => ({ id, name: `${id}.png`, nodeId: "n", path: `pics/${id}.png`, size: 1, state: uploadState, percent });

describe("StorageUploadStatus", () => {
	beforeEach(() => {
		state.clearFinished.mockReset();
	});

	it("renders nothing without uploads", () => {
		state.items = [];
		renderWithI18n(<StorageUploadStatus />);
		expect(screen.queryByRole("region")).not.toBeInTheDocument();
	});

	it("does not say it is uploading while everything left is paused", () => {
		// One paused file read "正在上传 1 个文件".
		state.items = [item("a", "paused", 40), item("b", "success", 100)];
		renderWithI18n(<StorageUploadStatus />);
		const panel = screen.getByRole("region", { name: "上传任务" });
		expect(panel).toHaveTextContent("已暂停 1 个文件");
		expect(panel).not.toHaveTextContent("正在上传");
	});

	it("counts paused files apart from the ones still going", () => {
		state.items = [item("a", "uploading", 50), item("b", "paused", 10), item("c", "pending")];
		renderWithI18n(<StorageUploadStatus />);
		expect(screen.getByRole("region", { name: "上传任务" })).toHaveTextContent("正在上传 2 个文件，已暂停 1 个");
	});

	it("summarises running uploads with overall progress and folds to its header", () => {
		state.items = [item("a", "uploading", 50), item("b", "success", 100), item("c", "pending")];
		renderWithI18n(<StorageUploadStatus />);
		const panel = screen.getByRole("region", { name: "上传任务" });
		expect(panel).toHaveTextContent("正在上传 2 个文件");
		expect(screen.getByRole("progressbar", { name: "上传任务" })).toHaveAttribute("aria-valuenow", "50");
		// While uploads run, only the finished rows can be cleared (the list footer), not the panel.
		expect(screen.getAllByRole("button", { name: "清除已结束任务" })).toHaveLength(1);
		expect(screen.getByText("a.png")).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "收起上传列表" }));
		expect(screen.queryByText("a.png")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "展开上传列表" })).toHaveAttribute("aria-expanded", "false");
	});

	it("reports failures and clears itself once nothing runs", () => {
		state.items = [item("a", "error"), item("b", "success", 100)];
		renderWithI18n(<StorageUploadStatus />);
		expect(screen.getByRole("region")).toHaveTextContent("1 个文件上传失败");
		fireEvent.click(screen.getAllByRole("button", { name: "清除已结束任务" })[0]!);
		expect(state.clearFinished).toHaveBeenCalledOnce();
	});
});
