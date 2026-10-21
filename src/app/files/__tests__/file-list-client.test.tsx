import React from "react";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileListClient, type FileProp, type FolderProp } from "../file-list-client";
import { ViewToggle } from "../drive-toolbar";

const mocks = vi.hoisted(() => ({
	push: vi.fn(),
	refresh: vi.fn(),
	remove: vi.fn(),
	rename: vi.fn(),
	move: vi.fn(),
	fetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("../../storage/actions", () => ({ deleteFileEntryAction: mocks.remove, renameFileEntryAction: mocks.rename, createFolderAction: vi.fn() }));
vi.mock("../move-file-action", () => ({ moveFileAction: mocks.move }));
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: mocks.fetch }));

const folder: FolderProp = {
	name: "photos",
	displayName: "photos",
	path: "photos",
	entryId: "dir_1",
	storageNodeId: "node_1",
	relativePath: "photos",
	fileCount: 2,
	folderCount: 1,
	sourceKeys: ["node_1"],
	sourceValues: ["本机存储"],
};

const imageFile: FileProp = {
	id: "file_1",
	name: "cover.jpg",
	entryType: "FILE",
	mimeType: "image/jpeg",
	relativePath: "photos/cover.jpg",
	sizeBytes: 10 * 1024,
	sizeLabel: "10 KB",
	previewable: true,
	directAccessMode: "managed-download",
	directAccessHref: "/api/storage/local?path=photos%2Fcover.jpg",
	directAccessDescription: "受控下载",
	storageNodeId: "node_1",
	storageNodeName: "本机存储",
	storageNodeDriver: "LOCAL",
	updatedAt: "2026-05-04T00:00:00.000Z",
};
const secondImage: FileProp = { ...imageFile, id: "file_img2", name: "beach.png", mimeType: "image/png", relativePath: "photos/beach.png" };
const archiveFile: FileProp = {
	...imageFile,
	id: "file_2",
	name: "archive.zip",
	mimeType: "application/zip",
	relativePath: "photos/archive.zip",
	sizeBytes: 2 * 1024 * 1024,
	sizeLabel: "2 MB",
	directAccessHref: "/api/storage/local?path=photos%2Farchive.zip",
	updatedAt: "2026-05-05T00:00:00.000Z",
};
const sftpDirectFile: FileProp = {
	...imageFile,
	id: "file_sftp_direct",
	name: "movie.mp4",
	mimeType: "video/mp4",
	relativePath: "media/movie.mp4",
	directAccessMode: "direct-url",
	directAccessHref: "https://cdn.example.com/media/movie.mp4?signature=abc",
	directAccessDescription: "目标服务器直连",
	storageNodeId: "node_sftp",
	storageNodeName: "远端媒体库",
	storageNodeDriver: "SFTP",
};
const officeFile: FileProp = {
	...imageFile,
	id: "file_office",
	name: "report.docx",
	mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	relativePath: "photos/report.docx",
	directAccessHref: "/api/storage/local?path=photos%2Freport.docx",
	updatedAt: "2026-05-07T00:00:00.000Z",
};
const docFile: FileProp = {
	...imageFile,
	id: "file_3",
	name: "report.pdf",
	mimeType: "application/pdf",
	relativePath: "photos/report.pdf",
	sizeBytes: 512,
	sizeLabel: "512 B",
	directAccessHref: "/api/storage/local?path=photos%2Freport.pdf",
	updatedAt: "2026-05-06T00:00:00.000Z",
};
const binaryFile: FileProp = { ...imageFile, id: "file_bin", name: "dump.bin", mimeType: "application/octet-stream", relativePath: "photos/dump.bin", previewable: false };
const directoryFile: FileProp = { ...imageFile, id: "dir_duplicate", name: "photos", entryType: "DIRECTORY", mimeType: null, relativePath: "photos", previewable: false, sizeLabel: "-" };
const directoryMimeFile: FileProp = { ...directoryFile, id: "dir_mime_duplicate", entryType: "FILE", mimeType: "inode/directory" };

type Props = React.ComponentProps<typeof FileListClient>;
function renderFileList(overrides: Partial<Props> = {}) {
	return render(
		<FileListClient
			folders={overrides.folders ?? [folder]}
			files={overrides.files ?? [imageFile]}
			canEditLocalFiles={overrides.canEditLocalFiles ?? true}
			canDelete={overrides.canDelete ?? true}
			canShare={overrides.canShare ?? false}
			currentPath={overrides.currentPath ?? ""}
			searchQuery={overrides.searchQuery ?? ""}
			nodeIdFilter={overrides.nodeIdFilter ?? "node_1"}
			showSource={overrides.showSource}
			selectionScopeSeed={overrides.selectionScopeSeed ?? `${overrides.currentPath ?? ""}\u0000${overrides.searchQuery ?? ""}`}
			selectionPage={overrides.selectionPage}
			onFolderClick={overrides.onFolderClick ?? vi.fn()}
			onRefresh={overrides.onRefresh ?? vi.fn()}
		/>,
	);
}

const checkbox = (name: string) => screen.getByRole("checkbox", { name: `选择 ${name}` });
const row = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-file-entry-id="${id}"]`)!;

async function openMore(name: string) {
	fireEvent.click(screen.getByRole("button", { name: `更多操作 ${name}` }));
	return screen.findByRole("menu", { name: `更多操作 ${name}` });
}

/** Capture the anchor `triggerDownload` creates and clicks. */
function captureDownloads() {
	const clicked: HTMLAnchorElement[] = [];
	const spy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
		clicked.push(this);
	});
	return { clicked, restore: () => spy.mockRestore() };
}

describe("FileListClient", () => {
	beforeEach(() => {
		window.localStorage.clear();
		Object.values(mocks).forEach((mock) => mock.mockReset());
		mocks.remove.mockResolvedValue({ success: "ok" });
		mocks.move.mockResolvedValue({ success: "ok" });
		mocks.fetch.mockResolvedValue({ message: "已创建压缩包 /photos/selected.tar.gz", relativePath: "photos/selected.tar.gz" });
	});
	afterEach(() => vi.restoreAllMocks());

	it("shows server thumbnails for image files and never for folders", () => {
		window.localStorage.setItem("app-file-view-mode", "grid");
		const { container } = renderFileList();
		expect(screen.getAllByTestId("folder-card")).toHaveLength(1);
		const thumbnails = container.querySelectorAll('[data-testid="file-thumbnail"]');
		expect(thumbnails).toHaveLength(1);
		expect(thumbnails[0]).toHaveAttribute("src", "/api/files/file_1/thumbnail?v=2026-05-04T00%3A00%3A00.000Z");
		expect(screen.getAllByTestId("folder-card")[0]!.querySelector('[data-testid="file-thumbnail"]')).toBeNull();
	});

	it("falls back to the type icon when a thumbnail cannot load", () => {
		const { container } = renderFileList({ folders: [] });
		const thumbnail = container.querySelector('[data-testid="file-thumbnail"]')!;
		fireEvent.error(thumbnail);
		expect(container.querySelector('[data-testid="file-thumbnail"]')).toBeNull();
		expect(container.querySelector('svg[data-file-kind="image"]')).not.toBeNull();
	});

	it("preserves selection across pages and only toggles the current page", () => {
		const props = { folders: [], canEditLocalFiles: true, canDelete: true, currentPath: "photos", searchQuery: "", selectionScopeSeed: "same-folder" };
		const { rerender } = render(<FileListClient {...props} files={[imageFile]} selectionPage={1} />);
		fireEvent.click(checkbox("cover.jpg"));
		rerender(<FileListClient {...props} files={[archiveFile]} selectionPage={2} />);
		expect(screen.getByText("已选 1 项")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("checkbox", { name: "全选文件" }));
		expect(screen.getByText("已选 2 项")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("checkbox", { name: "全选文件" }));
		expect(screen.getByText("已选 1 项")).toBeInTheDocument();
		rerender(<FileListClient {...props} files={[imageFile]} selectionPage={1} />);
		expect(checkbox("cover.jpg")).toBeChecked();
	});

	it("selects a row on click, adds with Ctrl and extends with Shift", () => {
		// Name order: archive.zip, cover.jpg, report.pdf.
		const { container } = renderFileList({ folders: [], files: [imageFile, archiveFile, docFile] });
		fireEvent.click(row(container, "file_2"));
		expect(screen.getByText("已选 1 项")).toBeInTheDocument();
		fireEvent.click(row(container, "file_3"), { shiftKey: true });
		expect(screen.getByText("已选 3 项")).toBeInTheDocument();
		fireEvent.click(row(container, "file_1"), { ctrlKey: true });
		expect(checkbox("cover.jpg")).not.toBeChecked();
		expect(screen.getByText("已选 2 项")).toBeInTheDocument();
		fireEvent.click(row(container, "file_1"));
		expect(screen.getByText("已选 1 项")).toBeInTheDocument();
		expect(checkbox("cover.jpg")).toBeChecked();
	});

	it.each(["list", "grid"])("rejects virtual folder drop targets in %s view", (mode) => {
		window.localStorage.setItem("app-file-view-mode", mode);
		const { container } = renderFileList({ folders: [{ ...folder, entryId: undefined }] });
		expect(container.querySelector("[data-file-drop-path]")).toBeNull();
	});

	it("asks before moving a file dragged onto a folder", async () => {
		const { container } = renderFileList();
		const source = container.querySelector('[data-file-entry-id="file_1"][draggable="true"]')!;
		const target = container.querySelector('[data-file-drop-path="photos"]')!;
		const data = new Map<string, string>();
		const transfer = { types: ["application/x-vcontrolhub-files"], setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key) ?? "" };
		fireEvent.dragStart(source, { dataTransfer: transfer });
		expect(JSON.parse(data.get("application/x-vcontrolhub-files")!)).toEqual({ ids: ["file_1"], nodeIds: ["node_1"] });
		fireEvent.drop(target, { dataTransfer: transfer });
		expect(await screen.findByRole("dialog")).toHaveTextContent("photos");
		expect(mocks.fetch).not.toHaveBeenCalledWith("/api/files/operations", expect.anything());
	});

	it("keeps all entries selected when Ctrl+A is pressed twice inside the list", () => {
		const { container } = renderFileList();
		const list = container.querySelector("[data-file-list]")!;
		fireEvent.keyDown(list, { key: "a", ctrlKey: true });
		expect(checkbox("cover.jpg")).toBeChecked();
		fireEvent.keyDown(list, { key: "a", ctrlKey: true });
		expect(checkbox("cover.jpg")).toBeChecked();
		fireEvent.keyDown(list, { key: "Escape" });
		expect(checkbox("cover.jpg")).not.toBeChecked();
	});

	it("does not intercept page selection or selection inside a modal", () => {
		const { container } = renderFileList();
		fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
		expect(checkbox("cover.jpg")).not.toBeChecked();
		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		dialog.setAttribute("aria-modal", "true");
		document.body.append(dialog);
		try {
			fireEvent.keyDown(container.querySelector("[data-file-list]")!, { key: "a", ctrlKey: true });
			expect(checkbox("cover.jpg")).not.toBeChecked();
		} finally {
			dialog.remove();
		}
	});

	it("opens delete for the selection with Delete and rename with F2", async () => {
		const { container } = renderFileList({ folders: [] });
		fireEvent.click(row(container, "file_1"));
		const list = container.querySelector("[data-file-list]")!;
		fireEvent.keyDown(list, { key: "F2" });
		expect(screen.getByRole("dialog", { name: "重命名" })).toBeVisible();
		fireEvent.click(within(screen.getByRole("dialog", { name: "重命名" })).getByRole("button", { name: "取消" }));
		fireEvent.keyDown(list, { key: "Delete" });
		expect(await screen.findByText("确认删除 cover.jpg？")).toBeVisible();
	});

	it("renders folder entries only once when directory entries also arrive in the files payload", () => {
		window.localStorage.setItem("app-file-view-mode", "grid");
		renderFileList({ files: [directoryFile, directoryMimeFile, imageFile] });
		expect(screen.getAllByTestId("folder-card")).toHaveLength(1);
		expect(screen.queryByText("-")).not.toBeInTheDocument();
		expect(screen.getByText("cover.jpg")).toBeInTheDocument();
	});

	it("selects displayed folders and files without duplicating hidden directory payload entries", () => {
		renderFileList({ files: [directoryFile, directoryMimeFile, imageFile] });
		fireEvent.click(screen.getByRole("checkbox", { name: "全选文件" }));
		expect(screen.getByText("已选 2 项")).toBeInTheDocument();
		expect(checkbox("cover.jpg")).toBeChecked();
	});

	it("follows the persisted view switch", () => {
		render(<><ViewToggle /><FileListClient folders={[folder]} files={[imageFile]} canEditLocalFiles canDelete currentPath="" searchQuery="" /></>);
		expect(screen.queryByTestId("folder-card")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "图标视图" }));
		expect(window.localStorage.getItem("app-file-view-mode")).toBe("grid");
		expect(screen.getByRole("button", { name: "图标视图" })).toHaveAttribute("aria-pressed", "true");
		expect(screen.getByTestId("folder-card")).toBeInTheDocument();
	});

	it("treats the retired details view as the list", () => {
		window.localStorage.setItem("app-file-view-mode", "details");
		renderFileList();
		expect(screen.getByTestId("file-table")).toBeInTheDocument();
	});

	it("labels the columns it shows and adds the source only for mixed listings", () => {
		const { unmount } = renderFileList();
		for (const label of ["名称", "修改时间", "大小"]) expect(screen.getByRole("button", { name: `按 ${label} 排序` })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "按 来源 排序" })).not.toBeInTheDocument();
		expect(screen.queryByText("类型")).not.toBeInTheDocument();
		expect(screen.queryByText("image/jpeg")).not.toBeInTheDocument();
		unmount();
		render(<FileListClient folders={[{ ...folder, sourceValues: ["本机存储 (LOCAL)"] }]} files={[]} canEditLocalFiles canDelete currentPath="" searchQuery="photos" showSource
			nodes={[{ id: "node_1", name: "本机存储", driver: "LOCAL" }]} onFolderClick={vi.fn()} />);
		expect(screen.getByRole("button", { name: "按 来源 排序" })).toBeInTheDocument();
		// A search hit names its node, not the listing's "name (DRIVER)" key.
		expect(screen.getByTitle("本机存储")).toBeInTheDocument();
		expect(screen.queryByText("本机存储 (LOCAL)")).not.toBeInTheDocument();
	});

	it("does not claim an item count for folders the index may not know", () => {
		renderFileList({ files: [] });
		expect(screen.queryByText(/3 项/)).not.toBeInTheDocument();
	});

	it("downloads through a plain anchor so API routes are never prefetched", () => {
		const downloads = captureDownloads();
		renderFileList({ folders: [] });
		fireEvent.click(screen.getByRole("button", { name: "下载 cover.jpg" }));
		expect(downloads.clicked).toHaveLength(1);
		expect(downloads.clicked[0]!.getAttribute("href")).toBe("/api/storage/local?path=photos%2Fcover.jpg&nodeId=node_1&download=1");
		expect(downloads.clicked[0]!.hasAttribute("download")).toBe(true);
		expect(downloads.clicked[0]!.isConnected).toBe(false);
		downloads.restore();
	});

	it("sorts by numeric file size instead of formatted labels", () => {
		const { container } = renderFileList({ files: [imageFile, archiveFile, docFile], folders: [] });
		fireEvent.click(screen.getByRole("button", { name: "按 大小 排序" }));
		const names = Array.from(container.querySelectorAll("[data-file-kind=file]")).map((node) => node.getAttribute("data-file-entry-id"));
		expect(names).toEqual(["file_3", "file_1", "file_2"]);
		expect(screen.getByRole("button", { name: "按 大小 排序" })).toHaveAttribute("data-sort-direction", "asc");
	});

	it("clears the selection when the folder or search changes while keeping the sort", () => {
		const props = { folders: [], canEditLocalFiles: true, canDelete: true, onFolderClick: vi.fn(), onRefresh: vi.fn() };
		const { rerender } = render(<FileListClient {...props} files={[imageFile, archiveFile, docFile]} currentPath="photos" searchQuery="" selectionScopeSeed={"photos\u0000"} />);
		fireEvent.click(screen.getByRole("button", { name: "按 大小 排序" }));
		fireEvent.click(checkbox("cover.jpg"));
		expect(screen.getByText("已选 1 项")).toBeInTheDocument();
		rerender(<FileListClient {...props} files={[docFile]} currentPath="docs" searchQuery="report" selectionScopeSeed={"docs\u0000report"} />);
		expect(screen.queryByText(/已选/)).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "按 大小 排序" })).toHaveAttribute("data-sort-direction", "asc");
		expect(screen.getByRole("link", { name: "report.pdf" })).toBeInTheDocument();
	});

	it("shows the folder of each search hit", () => {
		renderFileList({ folders: [], files: [docFile], searchQuery: "report" });
		expect(screen.getByText("/photos")).toBeInTheDocument();
	});

	it("offers one same-origin download for direct-access SFTP files", async () => {
		const downloads = captureDownloads();
		renderFileList({ files: [sftpDirectFile], folders: [] });
		expect(screen.queryByText("直连")).not.toBeInTheDocument();
		const menu = await openMore("movie.mp4");
		expect(within(menu).getAllByRole("menuitem", { name: /下载/ })).toHaveLength(1);
		fireEvent.click(within(menu).getByRole("menuitem", { name: "下载" }));
		expect(downloads.clicked[0]!.getAttribute("href")).toBe("/api/storage/sftp-download?nodeId=node_sftp&path=media%2Fmovie.mp4&download=1");
		downloads.restore();
	});

	it("says what opening Office files and archives does", async () => {
		renderFileList({ files: [officeFile, archiveFile], folders: [] });
		let menu = await openMore("report.docx");
		expect(within(menu).getByRole("menuitem", { name: /预览/ })).toHaveTextContent("Office 文件暂不做公网在线渲染，将打开下载提示页");
		fireEvent.keyDown(document, { key: "Escape" });
		menu = await openMore("archive.zip");
		expect(within(menu).getByRole("menuitem", { name: /预览/ })).toHaveTextContent("查看压缩包内容，可在受控流程中在线解压");
		expect(screen.getByRole("link", { name: "report.docx" })).toHaveAttribute("href", expect.stringContaining("/files/preview?"));
	});

	it("keeps actions in a portal menu that flips above a row near the bottom", async () => {
		Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
		renderFileList({ files: [imageFile], folders: [], canShare: true });
		const more = screen.getByRole("button", { name: "更多操作 cover.jpg" });
		vi.spyOn(more, "getBoundingClientRect").mockReturnValue({ x: 720, y: 760, top: 760, right: 752, bottom: 792, left: 720, width: 32, height: 32, toJSON: () => ({}) } as DOMRect);
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			if (this === more) return { x: 720, y: 760, top: 760, right: 752, bottom: 792, left: 720, width: 32, height: 32, toJSON: () => ({}) } as DOMRect;
			return { x: 0, y: 0, top: 0, right: 200, bottom: 300, left: 0, width: 200, height: 300, toJSON: () => ({}) } as DOMRect;
		});
		fireEvent.click(more);
		const menu = await screen.findByRole("menu", { name: "更多操作 cover.jpg" });
		expect(menu.parentElement).toBe(document.body);
		expect(Number.parseFloat(menu.style.top)).toBeLessThan(760);
		for (const label of ["预览", "下载", "分享", "资料详情", "收藏", "编辑标签…", "重命名", "移动到…", "复制到…", "删除"]) {
			expect(within(menu).getByRole("menuitem", { name: label })).toBeInTheDocument();
		}
	});

	it("opens the same menu on right-click", async () => {
		const { container } = renderFileList({ files: [imageFile], folders: [] });
		fireEvent.contextMenu(row(container, "file_1"), { clientX: 200, clientY: 150 });
		const menu = await screen.findByRole("menu", { name: "更多操作 cover.jpg" });
		expect(menu.style.left).toBe("200px");
		fireEvent.click(within(menu).getByRole("menuitem", { name: "重命名" }));
		expect(screen.getByRole("dialog", { name: "重命名" })).toBeVisible();
		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
	});

	it("offers extraction for ZIP/tar archives on local nodes only", async () => {
		const sftpArchive: FileProp = { ...archiveFile, id: "file_sftp_zip", name: "remote.zip", relativePath: "photos/remote.zip", storageNodeDriver: "SFTP" };
		renderFileList({ files: [archiveFile, sftpArchive, imageFile], folders: [] });
		expect(within(await openMore("archive.zip")).getByRole("menuitem", { name: /解压到文件夹/ })).toBeInTheDocument();
		fireEvent.keyDown(document, { key: "Escape" });
		expect(within(await openMore("remote.zip")).queryByRole("menuitem", { name: /解压到文件夹/ })).not.toBeInTheDocument();
		fireEvent.keyDown(document, { key: "Escape" });
		expect(within(await openMore("cover.jpg")).queryByRole("menuitem", { name: /解压到文件夹/ })).not.toBeInTheDocument();
	});

	it("offers archive downloads for indexed folders only", async () => {
		const downloads = captureDownloads();
		const groupRoot: FolderProp = { ...folder, name: "local__node_1", displayName: "本机存储", path: "local__node_1", entryId: null, storageNodeId: null, relativePath: null };
		const implicit: FolderProp = { ...folder, name: "docs", displayName: "docs", path: "docs", entryId: null, relativePath: null };
		renderFileList({ files: [], folders: [folder, groupRoot, implicit] });
		const menu = await openMore("photos");
		fireEvent.click(within(menu).getByRole("menuitem", { name: "下载目录归档" }));
		expect(downloads.clicked[0]!.getAttribute("href")).toBe("/api/storage/archive-download?nodeId=node_1&path=photos");
		// A folder known only from its files' paths can just be opened: no menu, no archive.
		expect(screen.queryByRole("button", { name: "更多操作 docs" })).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "docs" })).toBeInTheDocument();
		downloads.restore();
	});

	it("shows storage nodes at the all-locations root as locations, not folders", () => {
		const nodeRoot: FolderProp = { ...folder, name: "local__node_1", displayName: "本机存储 (LOCAL)", path: "local__node_1", entryId: null, storageNodeId: null, relativePath: null, sourceKeys: ["node_1"], sourceValues: ["本机存储 (LOCAL)"] };
		render(<FileListClient folders={[nodeRoot]} files={[]} canEditLocalFiles canDelete currentPath="" searchQuery="" showSource
			nodes={[{ id: "node_1", name: "本机存储", driver: "LOCAL", teamName: "Acme" }, { id: "node_2", name: "东京", driver: "SFTP", teamName: "平台自用" }]} onFolderClick={vi.fn()} />);
		expect(screen.getByRole("link", { name: "本机存储" })).toHaveAttribute("href", "/files?path=local__node_1");
		expect(screen.getByText("Acme")).toBeInTheDocument();
		expect(screen.queryByText("本机存储 (LOCAL)")).not.toBeInTheDocument();
		expect(screen.queryByRole("checkbox", { name: "选择 本机存储" })).not.toBeInTheDocument();
	});

	it("enables select-all when the listing holds only selectable directories", () => {
		renderFileList({ files: [], folders: [folder] });
		const selectAll = screen.getByRole("checkbox", { name: "全选文件" });
		expect(selectAll).toBeEnabled();
		fireEvent.click(selectAll);
		expect(checkbox("photos")).toBeChecked();
	});

	it.each(["list", "grid"])("keeps folder rename, move, download and delete in the %s view", async (mode) => {
		window.localStorage.setItem("app-file-view-mode", mode);
		renderFileList({ files: [], folders: [folder], canDelete: true });
		const menu = await openMore("photos");
		for (const label of ["打开", "下载目录归档", "重命名", "移动到…", "复制到…", "删除"]) {
			expect(within(menu).getByRole("menuitem", { name: label })).toBeInTheDocument();
		}
	});

	it("hides folder mutations when folder capabilities deny them", async () => {
		renderFileList({ files: [], folders: [{ ...folder, capabilities: { canRead: true, canWrite: false, canDelete: false } }], canDelete: true });
		const menu = await openMore("photos");
		expect(within(menu).getByRole("menuitem", { name: "下载目录归档" })).toBeInTheDocument();
		for (const label of ["重命名", "移动到…", "删除"]) expect(within(menu).queryByRole("menuitem", { name: label })).not.toBeInTheDocument();
	});

	it("opens a details drawer with preview, download, share and media actions", async () => {
		renderFileList({ files: [imageFile], folders: [], canShare: true });
		fireEvent.click(within(await openMore("cover.jpg")).getByRole("menuitem", { name: "资料详情" }));
		const dialog = await screen.findByRole("dialog", { name: "cover.jpg" }, { timeout: 5_000 });
		expect(dialog).toHaveAttribute("data-motion", "drawer");
		expect(dialog).toHaveTextContent("photos/cover.jpg");
		expect(dialog).toHaveTextContent("本机存储");
		expect(within(dialog).getByRole("link", { name: "预览 / 在线编辑" })).toHaveAttribute("href", expect.stringContaining("/files/preview?"));
		expect(within(dialog).getByRole("link", { name: "下载文件" })).toHaveAttribute("href", "/api/storage/local?path=photos%2Fcover.jpg&nodeId=node_1&download=1");
		expect(within(dialog).getByRole("link", { name: "在媒体库中查找" })).toHaveAttribute("href", "/media?q=cover.jpg&type=image");
		fireEvent.click(within(dialog).getByRole("button", { name: "分享" }));
		expect(await screen.findByRole("dialog", { name: /创建临时公开分享/ })).toBeVisible();
	});

	it("hides drawer actions when the entry cannot be read", async () => {
		renderFileList({ files: [{ ...imageFile, storageNodeDriver: "SFTP", capabilities: { canRead: false, canWrite: false, canDelete: false } }], folders: [], canShare: true });
		fireEvent.click(within(await openMore("cover.jpg")).getByRole("menuitem", { name: "资料详情" }));
		const dialog = await screen.findByRole("dialog", { name: "cover.jpg" }, { timeout: 5_000 });
		for (const name of ["预览 / 在线编辑", "下载文件", "在媒体库中查找"]) expect(within(dialog).queryByRole("link", { name })).not.toBeInTheDocument();
		expect(within(dialog).queryByRole("button", { name: "分享" })).not.toBeInTheDocument();
	});

	it("hides preview, download, delete and selection when capabilities deny access", () => {
		renderFileList({ folders: [], files: [{ ...imageFile, storageNodeDriver: "SFTP", capabilities: { canRead: false, canWrite: false, canDelete: false } }] });
		expect(screen.queryByRole("link", { name: /cover\.jpg/ })).not.toBeInTheDocument();
		expect(screen.queryByRole("checkbox", { name: "选择 cover.jpg" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "下载 cover.jpg" })).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("checkbox", { name: "全选文件" }));
		expect(screen.queryByText(/已选/)).not.toBeInTheDocument();
	});

	it("opens images in the viewer and steps through the folder", async () => {
		// Name order: beach.png, cover.jpg; the PDF is not part of the viewer.
		renderFileList({ folders: [], files: [imageFile, secondImage, docFile] });
		fireEvent.click(screen.getByRole("link", { name: "beach.png" }));
		const viewer = screen.getByRole("dialog", { name: "beach.png" });
		expect(within(viewer).getByRole("img", { name: "beach.png" })).toHaveAttribute("src", "/api/storage/local?path=photos%2Fbeach.png&nodeId=node_1");
		expect(within(viewer).queryByRole("button", { name: "上一张" })).not.toBeInTheDocument();
		fireEvent.keyDown(window, { key: "ArrowRight" });
		const next = await screen.findByRole("dialog", { name: "cover.jpg" });
		expect(within(next).queryByRole("button", { name: "下一张" })).not.toBeInTheDocument();
		fireEvent.click(within(next).getByRole("button", { name: "上一张" }));
		expect(await screen.findByRole("dialog", { name: "beach.png" })).toBeVisible();
		expect(mocks.push).not.toHaveBeenCalled();
	});

	it("previews other files on their page and shows details for the rest", async () => {
		renderFileList({ folders: [], files: [docFile, binaryFile] });
		fireEvent.click(screen.getByRole("link", { name: "report.pdf" }));
		expect(mocks.push).toHaveBeenCalledWith(expect.stringContaining("/files/preview?"));
		fireEvent.click(screen.getByRole("button", { name: "dump.bin" }));
		expect(await screen.findByRole("dialog", { name: "dump.bin" }, { timeout: 5_000 })).toHaveAttribute("data-motion", "drawer");
	});

	it("marks starred entries", () => {
		renderFileList({ folders: [{ ...folder, favorite: true }], files: [{ ...imageFile, favorite: true }] });
		expect(screen.getAllByLabelText("收藏")).toHaveLength(2);
	});

	it("uses per-entry capabilities for batch actions", () => {
		renderFileList({
			files: [
				{ ...imageFile, capabilities: { canRead: true, canWrite: true, canDelete: false } },
				{ ...archiveFile, capabilities: { canRead: true, canWrite: false, canDelete: true } },
			],
		});
		fireEvent.click(checkbox("cover.jpg"));
		const bar = screen.getByRole("region", { name: "文件批量操作" });
		expect(within(bar).getByRole("button", { name: "移动到…" })).toBeInTheDocument();
		expect(within(bar).getByRole("button", { name: "压缩" })).toBeInTheDocument();
		expect(within(bar).queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
		expect(within(bar).getByRole("button", { name: "下载" })).toBeInTheDocument();
		fireEvent.click(checkbox("archive.zip"));
		for (const name of ["移动到…", "压缩", "删除", "下载"]) expect(within(bar).queryByRole("button", { name })).not.toBeInTheDocument();
	});

	it("hides batch compress for writable SFTP selections (the API is LOCAL-only)", () => {
		renderFileList({ files: [{ ...sftpDirectFile, capabilities: { canRead: true, canWrite: true, canDelete: true } }], canDelete: true });
		fireEvent.click(checkbox("movie.mp4"));
		const bar = screen.getByRole("region", { name: "文件批量操作" });
		expect(within(bar).getByRole("button", { name: "移动到…" })).toBeInTheDocument();
		expect(within(bar).queryByRole("button", { name: "压缩" })).not.toBeInTheDocument();
		expect(within(bar).getByRole("button", { name: "删除" })).toBeInTheDocument();
	});

	it("creates a tar.gz archive from the selected files", async () => {
		const onRefresh = vi.fn();
		renderFileList({ files: [imageFile, docFile], onRefresh });
		fireEvent.click(checkbox("cover.jpg"));
		fireEvent.click(checkbox("report.pdf"));
		fireEvent.click(screen.getByRole("button", { name: "压缩" }));
		await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
		expect(mocks.fetch).toHaveBeenCalledWith("/api/files/compress", expect.objectContaining({ method: "POST", headers: { "Content-Type": "application/json" }, body: expect.any(String) }));
		const body = JSON.parse(mocks.fetch.mock.calls[0]![1].body);
		expect(body).toMatchObject({ storageNodeId: "node_1", relativePaths: ["photos/cover.jpg", "photos/report.pdf"], targetDir: "" });
		expect(body.outputName).toMatch(/^selected-.+\.tar\.gz$/);
		await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
		expect(screen.queryByText("已选 2 项")).not.toBeInTheDocument();
	});

	it.each(["delete", "move"] as const)("keeps the selection when a background %s cannot be queued", async (action) => {
		mocks.fetch.mockImplementation(async (url: string) => {
			if (url.startsWith("/api/files/list")) return { folders: [{ name: "archive", path: "archive", relativePath: "archive", fileCount: 0, folderCount: 0, sourceKeys: ["node_1"], sourceValues: ["本机存储"] }], pagination: { page: 1, pageSize: 50, totalItems: 1, totalPages: 1 } };
			throw new Error("任务创建失败");
		});
		const onRefresh = vi.fn();
		renderFileList({ files: [imageFile, archiveFile], folders: [], onRefresh });
		fireEvent.click(checkbox("cover.jpg"));
		fireEvent.click(checkbox("archive.zip"));
		const bar = screen.getByRole("region", { name: "文件批量操作" });
		if (action === "delete") {
			fireEvent.click(within(bar).getByRole("button", { name: "删除" }));
			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "确认" }));
			});
		} else {
			fireEvent.click(within(bar).getByRole("button", { name: "移动到…" }));
			const dialog = screen.getByRole("dialog", { name: "移动到" });
			fireEvent.click(await within(dialog).findByRole("button", { name: "archive" }));
			const confirm = within(dialog).getByRole("button", { name: "移动到此处" });
			await waitFor(() => expect(confirm).toBeEnabled());
			await act(async () => {
				fireEvent.click(confirm);
			});
		}
		const operation = mocks.fetch.mock.calls.find(([url]) => url === "/api/files/operations")!;
		expect(JSON.parse(operation[1].body)).toMatchObject({ action, fileEntryIds: ["file_1", "file_2"], requestId: expect.any(String) });
		expect(await screen.findByText("任务创建失败")).toBeInTheDocument();
		expect(checkbox("cover.jpg")).toBeChecked();
		expect(checkbox("archive.zip")).toBeChecked();
		expect(onRefresh).not.toHaveBeenCalled();
	});

	it("drops the selection bar when the selection scope changes", () => {
		const props = { folders: [], canEditLocalFiles: true, canDelete: true, currentPath: "photos", searchQuery: "", onFolderClick: vi.fn(), onRefresh: vi.fn() };
		const { rerender } = render(<FileListClient {...props} files={[imageFile]} selectionScopeSeed={"epoch0\u0000photos\u0000"} />);
		fireEvent.click(checkbox("cover.jpg"));
		expect(screen.getByRole("region", { name: "文件批量操作" })).toBeInTheDocument();
		rerender(<FileListClient {...props} files={[docFile]} selectionScopeSeed={"epoch1\u0000photos\u0000"} />);
		expect(screen.queryByRole("region", { name: "文件批量操作" })).not.toBeInTheDocument();
	});
});
