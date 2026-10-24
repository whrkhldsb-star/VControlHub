import { act, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), restore: vi.fn(), purge: vi.fn(), toast: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }) }));
vi.mock("../../storage/actions", () => ({ restoreFileEntryAction: mocks.restore, permanentDeleteFileEntryAction: mocks.purge }));
vi.mock("@/components/toast-provider", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/components/toast-provider")>()),
	useToast: () => ({ addToast: mocks.toast }),
}));
vi.mock("../restore-button", () => ({
	RestoreButton: ({ onRefresh }: { onRefresh?: () => void }) => <button type="button" onClick={onRefresh}>Restore fixture</button>,
}));
vi.mock("../permanent-delete-button", () => ({
	PermanentDeleteButton: ({ onRefresh }: { onRefresh?: () => void }) => <button type="button" onClick={onRefresh}>Delete fixture</button>,
}));

import { RecycleBinSectionClient, type DeletedEntryProp } from "../recycle-bin-section-client";

const entries: DeletedEntryProp[] = [
	{ id: "entry-1", name: "obsolete.txt", entryType: "FILE", relativePath: "docs/obsolete.txt", size: 12, mimeType: "text/plain", deletedAt: "2026-10-20T06:31:00.000Z", storageNodeName: "本机存储" },
	{ id: "entry-2", name: "old-photos", entryType: "DIRECTORY", relativePath: "old-photos", size: null, storageNodeName: "东京 VPS" },
	{ id: "entry-3", name: "draft.md", entryType: "FILE", relativePath: "draft.md", size: 2048 },
];

describe("RecycleBinSectionClient", () => {
	beforeEach(() => Object.values(mocks).forEach((mock) => mock.mockReset()));

	it.each(["Restore fixture", "Delete fixture"])("removes a completed entry immediately after %s", (actionName) => {
		render(<RecycleBinSectionClient canDelete deletedEntries={[entries[0]!]} />);
		fireEvent.click(screen.getAllByRole("button", { name: actionName })[0]!);
		expect(screen.queryByText("obsolete.txt")).not.toBeInTheDocument();
		expect(mocks.refresh).toHaveBeenCalledOnce();
	});

	it("shows where each entry came from and when it was deleted", () => {
		render(<RecycleBinSectionClient canDelete deletedEntries={entries} />);
		const table = screen.getByRole("table");
		expect(within(table).getByText("本机存储 · /docs/obsolete.txt")).toBeInTheDocument();
		expect(within(table).getByText("2026/10/20 14:31")).toBeInTheDocument();
		expect(within(table).getByRole("columnheader", { name: "删除时间" })).toBeInTheDocument();
	});

	it("restores several entries and keeps the ones that failed selected", async () => {
		mocks.restore.mockImplementation(async (_prev: unknown, form: FormData) =>
			form.get("fileEntryId") === "entry-2" ? { error: "原位置已有同名项目" } : { success: "ok" });
		render(<RecycleBinSectionClient canDelete deletedEntries={entries} />);
		const table = screen.getByRole("table");
		fireEvent.click(within(table).getByRole("checkbox", { name: "选择 obsolete.txt" }));
		fireEvent.click(within(table).getByRole("checkbox", { name: "选择 old-photos" }));
		const bar = screen.getByRole("region", { name: "回收站批量操作" });
		expect(bar).toHaveTextContent("已选 2 项");
		await act(async () => {
			fireEvent.click(within(bar).getByRole("button", { name: "恢复所选" }));
		});
		expect(mocks.restore).toHaveBeenCalledTimes(2);
		expect(screen.queryByText("obsolete.txt")).not.toBeInTheDocument();
		expect(within(screen.getByRole("table")).getByRole("checkbox", { name: "选择 old-photos" })).toBeChecked();
		expect(screen.getByText("old-photos: 原位置已有同名项目")).toBeInTheDocument();
		expect(mocks.toast).toHaveBeenCalledWith("warning", "已恢复 1 项");
	});

	it("keeps the failures and their selection when the refreshed list arrives", async () => {
		// The page keyed the list on its entries, so the refresh after a partly
		// failed batch remounted it and the failure details were gone.
		mocks.restore.mockImplementation(async (_prev: unknown, form: FormData) =>
			form.get("fileEntryId") === "entry-2" ? { error: "原始文件已不存在" } : { success: "ok" });
		const { rerender } = render(<RecycleBinSectionClient canDelete deletedEntries={entries} />);
		const table = screen.getByRole("table");
		fireEvent.click(within(table).getByRole("checkbox", { name: "选择 obsolete.txt" }));
		fireEvent.click(within(table).getByRole("checkbox", { name: "选择 old-photos" }));
		await act(async () => {
			fireEvent.click(within(screen.getByRole("region", { name: "回收站批量操作" })).getByRole("button", { name: "恢复所选" }));
		});
		rerender(<RecycleBinSectionClient canDelete deletedEntries={entries.slice(1)} />);
		expect(screen.getByText("old-photos: 原始文件已不存在")).toBeInTheDocument();
		expect(within(screen.getByRole("table")).getByRole("checkbox", { name: "选择 old-photos" })).toBeChecked();
	});

	it("does not report what a selected folder already took care of", async () => {
		// Restoring the folder restores the file deleted with it; restoring the
		// file afterwards failed as "not in the recycle bin" and the batch warned.
		mocks.restore.mockResolvedValue({ success: "ok" });
		const folder: DeletedEntryProp = { id: "dir", name: "reports", entryType: "DIRECTORY", relativePath: "reports", size: null, storageNodeId: "node-1", deleteBatchId: "batch-1" };
		const child: DeletedEntryProp = { id: "child", name: "q3.txt", entryType: "FILE", relativePath: "reports/q3.txt", size: 3, storageNodeId: "node-1", deleteBatchId: "batch-1" };
		render(<RecycleBinSectionClient canDelete deletedEntries={[child, folder]} />);
		fireEvent.click(screen.getByRole("checkbox", { name: "全选回收站项目" }));
		await act(async () => {
			fireEvent.click(within(screen.getByRole("region", { name: "回收站批量操作" })).getByRole("button", { name: "恢复所选" }));
		});
		expect(mocks.restore).toHaveBeenCalledOnce();
		expect(mocks.restore.mock.calls[0]![1].get("fileEntryId")).toBe("dir");
		expect(mocks.toast).toHaveBeenCalledWith("success", "已恢复 1 项");
	});

	it("restores a file deleted before its folder on its own", async () => {
		// Deleted first, then its folder: two operations. Restoring the folder
		// leaves the file in the recycle bin, yet the batch skipped it, cleared
		// its selection and reported success.
		mocks.restore.mockResolvedValue({ success: "ok" });
		const folder: DeletedEntryProp = { id: "dir", name: "reports", entryType: "DIRECTORY", relativePath: "reports", size: null, storageNodeId: "node-1", deleteBatchId: "batch-2" };
		const child: DeletedEntryProp = { id: "child", name: "q3.txt", entryType: "FILE", relativePath: "reports/q3.txt", size: 3, storageNodeId: "node-1", deleteBatchId: "batch-1" };
		render(<RecycleBinSectionClient canDelete deletedEntries={[child, folder]} />);
		fireEvent.click(screen.getByRole("checkbox", { name: "全选回收站项目" }));
		await act(async () => {
			fireEvent.click(within(screen.getByRole("region", { name: "回收站批量操作" })).getByRole("button", { name: "恢复所选" }));
		});
		expect(mocks.restore.mock.calls.map((call) => call[1].get("fileEntryId")).sort()).toEqual(["child", "dir"]);
		expect(mocks.toast).toHaveBeenCalledWith("success", "已恢复 2 项");
	});

	it("still treats everything under a purged folder as covered, whatever its batch", async () => {
		mocks.purge.mockResolvedValue({ success: "ok" });
		const folder: DeletedEntryProp = { id: "dir", name: "reports", entryType: "DIRECTORY", relativePath: "reports", size: null, storageNodeId: "node-1", deleteBatchId: "batch-2" };
		const child: DeletedEntryProp = { id: "child", name: "q3.txt", entryType: "FILE", relativePath: "reports/q3.txt", size: 3, storageNodeId: "node-1", deleteBatchId: "batch-1" };
		render(<RecycleBinSectionClient canDelete deletedEntries={[child, folder]} />);
		fireEvent.click(screen.getByRole("checkbox", { name: "全选回收站项目" }));
		fireEvent.click(within(screen.getByRole("region", { name: "回收站批量操作" })).getByRole("button", { name: "永久删除所选" }));
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "永久删除" }));
		});
		expect(mocks.purge.mock.calls.map((call) => call[1].get("fileEntryId"))).toEqual(["dir"]);
	});

	it("still handles a covered entry itself when its folder failed", async () => {
		mocks.restore.mockImplementation(async (_prev: unknown, form: FormData) =>
			form.get("fileEntryId") === "dir" ? { error: "原位置已有同名项目" } : { success: "ok" });
		const folder: DeletedEntryProp = { id: "dir", name: "reports", entryType: "DIRECTORY", relativePath: "reports", size: null, storageNodeId: "node-1", deleteBatchId: "batch-1" };
		const child: DeletedEntryProp = { id: "child", name: "q3.txt", entryType: "FILE", relativePath: "reports/q3.txt", size: 3, storageNodeId: "node-1", deleteBatchId: "batch-1" };
		render(<RecycleBinSectionClient canDelete deletedEntries={[child, folder]} />);
		fireEvent.click(screen.getByRole("checkbox", { name: "全选回收站项目" }));
		await act(async () => {
			fireEvent.click(within(screen.getByRole("region", { name: "回收站批量操作" })).getByRole("button", { name: "恢复所选" }));
		});
		expect(mocks.restore.mock.calls.map((call) => call[1].get("fileEntryId"))).toEqual(["dir", "child"]);
	});

	it("asks before purging the selection for good", async () => {
		mocks.purge.mockResolvedValue({ success: "ok" });
		render(<RecycleBinSectionClient canDelete deletedEntries={entries} />);
		fireEvent.click(screen.getByRole("checkbox", { name: "全选回收站项目" }));
		fireEvent.click(within(screen.getByRole("region", { name: "回收站批量操作" })).getByRole("button", { name: "永久删除所选" }));
		expect(mocks.purge).not.toHaveBeenCalled();
		expect(screen.getByText("永久删除选中的 3 项？此操作不可恢复。")).toBeVisible();
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "永久删除" }));
		});
		expect(mocks.purge).toHaveBeenCalledTimes(3);
		expect(screen.queryByRole("table")).not.toBeInTheDocument();
		expect(mocks.toast).toHaveBeenCalledWith("success", "已永久删除 3 项");
	});

	it("offers no selection without delete permission", () => {
		render(<RecycleBinSectionClient canDelete={false} deletedEntries={entries} />);
		expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
	});
});
