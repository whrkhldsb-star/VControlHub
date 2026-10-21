import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";

const mocks = vi.hoisted(() => ({
	rename: vi.fn(),
	remove: vi.fn(),
	move: vi.fn(),
	submit: vi.fn(),
	fetch: vi.fn(),
	toast: vi.fn(),
}));
vi.mock("../../storage/actions", () => ({ renameFileEntryAction: mocks.rename, deleteFileEntryAction: mocks.remove }));
vi.mock("../move-file-action", () => ({ moveFileAction: mocks.move }));
vi.mock("../file-operation-controls", () => ({ submitFileOperation: mocks.submit }));
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: mocks.fetch }));
vi.mock("@/components/toast-provider", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/components/toast-provider")>()),
	useToast: () => ({ addToast: mocks.toast }),
}));

import { FileActionsProvider, useFileActions, type FileActionTarget } from "../file-actions";

const photo: FileActionTarget = { id: "f1", name: "屏幕截图 2026-10-01 14.31.png", entryType: "FILE", relativePath: "pics/屏幕截图 2026-10-01 14.31.png", storageNodeId: "n1", storageNodeName: "本机" };
const report: FileActionTarget = { id: "f2", name: "report.pdf", entryType: "FILE", relativePath: "pics/report.pdf", storageNodeId: "n1" };
const bundle: FileActionTarget = { id: "z1", name: "site.zip", entryType: "FILE", relativePath: "downloads/site.zip", storageNodeId: "n1" };
const docs: FileActionTarget = { id: "d1", name: "docs", entryType: "DIRECTORY", relativePath: "docs", storageNodeId: "n1" };

function Buttons() {
	const actions = useFileActions();
	return (
		<>
			<button type="button" onClick={() => actions.rename(photo)}>do-rename</button>
			<button type="button" onClick={() => actions.move([photo])}>do-move-one</button>
			<button type="button" onClick={() => actions.move([photo, report])}>do-move-two</button>
			<button type="button" onClick={() => actions.move([docs])}>do-move-folder</button>
			<button type="button" onClick={() => actions.copy([photo, report])}>do-copy</button>
			<button type="button" onClick={() => actions.remove([photo])}>do-delete-one</button>
			<button type="button" onClick={() => actions.remove([photo, report])}>do-delete-two</button>
			<button type="button" onClick={() => actions.share(photo)}>do-share</button>
			<button type="button" onClick={() => actions.editTags(photo)}>do-tags</button>
			<button type="button" onClick={() => void actions.toggleFavorite({ ...photo, favorite: true })}>do-unstar</button>
			<button type="button" onClick={() => void actions.extract(bundle)}>do-extract</button>
		</>
	);
}

const onChanged = vi.fn();
const onCleared = vi.fn();
function renderActions() {
	return renderWithI18n(
		<FileActionsProvider onChanged={onChanged} onCleared={onCleared}>
			<Buttons />
		</FileActionsProvider>,
	);
}

const folderListing = (folders: Array<{ name: string; path: string }>) => ({
	folders: folders.map((folder) => ({ ...folder, relativePath: folder.path, fileCount: 0, folderCount: 0, sourceKeys: ["n1"], sourceValues: ["本机"] })),
	pagination: { page: 1, pageSize: 50, totalItems: folders.length, totalPages: 1 },
});

describe("FileActionsProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.fetch.mockImplementation(async (url: string) => {
			if (url.startsWith("/api/files/list")) {
				return url.includes("path=pics") ? folderListing([]) : folderListing([{ name: "docs", path: "docs" }, { name: "pics", path: "pics" }]);
			}
			return {};
		});
	});

	it("renames with the base name selected, accepts spaces and reports server errors inline", async () => {
		mocks.rename.mockResolvedValueOnce({ error: "目标已存在" }).mockResolvedValueOnce({ success: "已重命名" });
		renderActions();
		fireEvent.click(screen.getByRole("button", { name: "do-rename" }));
		const dialog = screen.getByRole("dialog", { name: "重命名" });
		const input = within(dialog).getByLabelText("新名称") as HTMLInputElement;
		expect(input.value).toBe(photo.name);
		expect([input.selectionStart, input.selectionEnd]).toEqual([0, photo.name.lastIndexOf(".")]);
		const confirm = within(dialog).getByRole("button", { name: "确认" });
		expect(confirm).toBeDisabled();
		fireEvent.change(input, { target: { value: "a/b.png" } });
		expect(within(dialog).getByRole("alert")).toHaveTextContent("名称不能包含");
		expect(confirm).toBeDisabled();
		fireEvent.change(input, { target: { value: "  新的 截图.png " } });
		await act(async () => {
			fireEvent.click(confirm);
		});
		expect(mocks.rename.mock.calls[0]![1].get("newName")).toBe("新的 截图.png");
		expect(within(dialog).getByRole("alert")).toHaveTextContent("目标已存在");
		await act(async () => {
			fireEvent.click(confirm);
		});
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(onChanged).toHaveBeenCalledOnce();
		expect(mocks.toast).toHaveBeenCalledWith("success", "已重命名");
	});

	it("moves one entry through the server action into the folder on screen", async () => {
		mocks.move.mockResolvedValue({ success: "ok" });
		renderActions();
		fireEvent.click(screen.getByRole("button", { name: "do-move-one" }));
		const dialog = screen.getByRole("dialog", { name: "移动到" });
		// It opens in the entry's own folder, where moving would change nothing.
		await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining("path=pics"), expect.anything()));
		const confirm = within(dialog).getByRole("button", { name: "移动到此处" });
		await waitFor(() => expect(within(dialog).getByText("所选项目已在此文件夹中，请选择其他文件夹。")).toBeVisible());
		expect(confirm).toBeDisabled();
		fireEvent.click(within(dialog).getByRole("button", { name: /本机/ }));
		fireEvent.click(await within(dialog).findByRole("button", { name: "docs" }));
		await waitFor(() => expect(confirm).toBeEnabled());
		await act(async () => {
			fireEvent.click(confirm);
		});
		const form = mocks.move.mock.calls[0]![1] as FormData;
		expect([form.get("fileEntryId"), form.get("targetDir"), form.get("storageNodeId")]).toEqual(["f1", "docs", "n1"]);
		expect(onChanged).toHaveBeenCalledOnce();
	});

	it("queues several entries and never offers a moved folder as its own destination", async () => {
		mocks.submit.mockResolvedValue({ id: "job" });
		renderActions();
		fireEvent.click(screen.getByRole("button", { name: "do-move-folder" }));
		let dialog = screen.getByRole("dialog", { name: "移动到" });
		fireEvent.click(within(dialog).getByRole("button", { name: /本机|全部文件/ }));
		expect(await within(dialog).findByRole("button", { name: "docs" })).toBeDisabled();
		fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

		fireEvent.click(screen.getByRole("button", { name: "do-move-two" }));
		dialog = screen.getByRole("dialog", { name: "移动到" });
		fireEvent.click(within(dialog).getByRole("button", { name: /本机/ }));
		fireEvent.click(await within(dialog).findByRole("button", { name: "docs" }));
		const confirm = within(dialog).getByRole("button", { name: "移动到此处" });
		await waitFor(() => expect(confirm).toBeEnabled());
		await act(async () => {
			fireEvent.click(confirm);
		});
		expect(mocks.submit).toHaveBeenCalledWith({ action: "move", fileEntryIds: ["f1", "f2"], targetDir: "docs", policy: "skip" }, expect.any(String));
		expect(onCleared).toHaveBeenCalledOnce();
		expect(mocks.move).not.toHaveBeenCalled();
	});

	it("copies with the chosen conflict policy, also into the same folder", async () => {
		mocks.submit.mockResolvedValue({ id: "job" });
		renderActions();
		fireEvent.click(screen.getByRole("button", { name: "do-copy" }));
		const dialog = screen.getByRole("dialog", { name: "复制到" });
		const confirm = within(dialog).getByRole("button", { name: "复制到此处" });
		await waitFor(() => expect(confirm).toBeEnabled());
		fireEvent.change(within(dialog).getByLabelText("同名项目"), { target: { value: "overwrite" } });
		expect(within(dialog).getByText(/同名文件将被替换/)).toBeVisible();
		await act(async () => {
			fireEvent.click(confirm);
		});
		expect(mocks.submit).toHaveBeenCalledWith({ action: "copy", fileEntryIds: ["f1", "f2"], targetDir: "pics", policy: "overwrite" }, expect.any(String));
	});

	it("deletes one entry at once and queues several", async () => {
		mocks.remove.mockResolvedValue({ success: "已删除" });
		mocks.submit.mockResolvedValue({ id: "job" });
		renderActions();
		fireEvent.click(screen.getByRole("button", { name: "do-delete-one" }));
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "确认" }));
		});
		expect(mocks.remove.mock.calls[0]![1].get("fileEntryId")).toBe("f1");
		expect(onChanged).toHaveBeenCalledOnce();
		fireEvent.click(screen.getByRole("button", { name: "do-delete-two" }));
		expect(screen.getByText("确认删除选中的 2 个项目？它们会进入回收站。")).toBeVisible();
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "确认" }));
		});
		expect(mocks.submit).toHaveBeenCalledWith({ action: "delete", fileEntryIds: ["f1", "f2"], targetDir: ".", policy: "skip" }, expect.any(String));
		expect(onCleared).toHaveBeenCalledOnce();
	});

	it("creates a quick share only after confirmation and shows the link", async () => {
		mocks.fetch.mockImplementation(async (url: string) => (url === "/api/share-links" ? { token: "tok123" } : {}));
		const writeText = vi.fn(async () => undefined);
		Object.assign(navigator, { clipboard: { writeText } });
		renderActions();
		fireEvent.click(screen.getByRole("button", { name: "do-share" }));
		const dialog = screen.getByRole("dialog", { name: /创建临时公开分享/ });
		expect(mocks.fetch).not.toHaveBeenCalled();
		await act(async () => {
			fireEvent.click(within(dialog).getByRole("button", { name: "创建临时链接" }));
		});
		expect(mocks.fetch).toHaveBeenCalledWith("/api/share-links", expect.objectContaining({ method: "POST", body: JSON.stringify({ fileEntryId: "f1", quick: true }) }));
		expect(within(dialog).getByText(`${window.location.origin}/share/tok123`)).toBeVisible();
		expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/share/tok123`);
	});

	it("extracts an archive into a new folder and refreshes, or says why it could not", async () => {
		mocks.fetch.mockResolvedValueOnce({ message: "已解压 2 个文件到文件夹“site”", folder: "downloads/site" });
		renderActions();
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "do-extract" }));
		});
		expect(mocks.fetch).toHaveBeenCalledWith("/api/files/extract", {
			method: "POST",
			body: JSON.stringify({ nodeId: "n1", relativePath: "downloads/site.zip", driver: "LOCAL", name: "site.zip" }),
		});
		expect(mocks.toast).toHaveBeenCalledWith("success", "已解压 2 个文件到文件夹“site”");
		expect(onChanged).toHaveBeenCalledOnce();

		mocks.fetch.mockRejectedValueOnce(new Error("压缩包内含不安全的路径（../x），未解压任何内容"));
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "do-extract" }));
		});
		expect(mocks.toast).toHaveBeenLastCalledWith("error", "压缩包内含不安全的路径（../x），未解压任何内容");
		expect(onChanged).toHaveBeenCalledOnce();
	});

	it("stars and edits tags through the preferences API", async () => {
		mocks.fetch.mockImplementation(async (_url: string, init?: { method?: string }) => {
			if (init?.method === "PATCH") return {};
			return { items: [{ favorite: false, tags: ["工作"] }] };
		});
		renderActions();
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "do-unstar" }));
		});
		expect(mocks.fetch).toHaveBeenCalledWith("/api/files/preferences", { method: "PATCH", body: JSON.stringify({ fileEntryId: "f1", favorite: false }) });
		expect(onChanged).toHaveBeenCalledOnce();

		fireEvent.click(screen.getByRole("button", { name: "do-tags" }));
		const dialog = screen.getByRole("dialog", { name: "收藏与标签" });
		const tags = within(dialog).getByLabelText("标签") as HTMLInputElement;
		await waitFor(() => expect(tags.value).toBe("工作"));
		fireEvent.change(tags, { target: { value: "工作，文档, 截图" } });
		await act(async () => {
			fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
		});
		expect(mocks.fetch).toHaveBeenLastCalledWith("/api/files/preferences", {
			method: "PATCH",
			body: JSON.stringify({ fileEntryId: "f1", favorite: false, tags: ["工作", "文档", "截图"] }),
		});
	});
});
