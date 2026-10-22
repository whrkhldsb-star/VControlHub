import React from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FilesBrowserSpa } from "../files-browser-spa";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { expectTouchTarget } from "@/test/ui-assertions";

const mocks = vi.hoisted(() => ({ push: vi.fn(), createFolder: vi.fn(), enqueue: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("../../storage/actions", () => ({ createFolderAction: mocks.createFolder }));
vi.mock("@/components/storage/storage-upload-provider", () => ({ useStorageUploads: () => ({ enqueue: mocks.enqueue }) }));

vi.mock("@/components/storage/file-upload-dropzone", () => ({
	FileUploadDropzone: (props: { initialNodeId?: string; onUploadComplete?: () => void; pendingFiles?: File[] }) =>
		React.createElement("button", {
			type: "button",
			onClick: () => props.onUploadComplete?.(),
			"data-initial-node-id": props.initialNodeId ?? "",
			"data-pending-files": (props.pendingFiles ?? []).map((file) => file.name).join(","),
		}, "模拟上传完成"),
}));

vi.mock("../recent-downloads-panel", () => ({
	RecentDownloadsPanel: () => React.createElement("button", { type: "button" }, "打开最近下载"),
}));

vi.mock("../file-list-client", () => ({
	FileListClient: (props: { files: Array<{ name: string }> }) =>
		React.createElement("div", { "data-testid": "file-list" }, props.files.map((file) => React.createElement("span", { key: file.name }, file.name))),
}));

const file = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
	id,
	name,
	entryType: "FILE",
	mimeType: "image/jpeg",
	relativePath: `photos/${name}`,
	sizeLabel: "10 KB",
	previewable: true,
	directAccessMode: "managed-download",
	directAccessHref: `/api/storage/local?path=photos%2F${name}`,
	directAccessDescription: "受控下载",
	storageNodeId: "node_1",
	storageNodeName: "本机存储",
	storageNodeDriver: "LOCAL",
	updatedAt: "2026-05-04T00:00:00.000Z",
	...extra,
});

const baseData = {
	currentPath: "photos",
	nodeIdFilter: "node_1",
	folders: [],
	files: [file("file_1", "before.jpg")],
	tree: {
		name: "root",
		path: "",
		children: [{
			name: "photos", path: "photos", fileCount: 1, folderCount: 1, sourceKeys: [], sourceValues: [],
			children: [{ name: "raw", path: "photos/raw", fileCount: 2, folderCount: 0, sourceKeys: [], sourceValues: [], children: [] }],
		}],
	},
	stats: {
		totalNodes: 1, defaultNodeName: "本机存储", localNodeCount: 1, sftpNodeCount: 0, totalEntries: 1,
		previewableEntries: 1, deletedEntries: 3, remoteDirectoryCount: 0, totalItems: 1,
	},
	sourceSummary: ["本机存储"],
	searchQuery: "",
	searchScope: "current" as const,
	permissions: { canEditLocalFiles: true, canDelete: true, canManageNodes: true },
	nodes: [{ id: "node_1", name: "本机存储", driver: "LOCAL", healthStatus: "HEALTHY" }],
};

const twoNodes = [
	{ id: "node_1", name: "本机存储", driver: "LOCAL", teamName: "平台自用" },
	{ id: "node_sftp_1", name: "香港 VPS", driver: "SFTP", teamName: "Acme" },
];

function respondWith(data: Record<string, unknown>) {
	return { ok: true, json: async () => data } as Response;
}

describe("FilesBrowserSpa", () => {
	beforeEach(() => {
		mocks.push.mockReset();
		mocks.createFolder.mockReset();
		mocks.enqueue.mockReset();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respondWith({ ...baseData, files: [file("file_2", "after.jpg")] })));
	});

	it("labels the search box and switches its scope", async () => {
		renderWithI18n(<FilesBrowserSpa initialData={baseData} />);
		const search = screen.getByRole("searchbox", { name: "搜索文件名" });
		expect(search).toHaveAttribute("placeholder", "在当前目录搜索…");
		fireEvent.change(screen.getByLabelText("搜索范围"), { target: { value: "all" } });
		expect(search).toHaveAttribute("placeholder", "在全部文件中搜索…");
		fireEvent.change(search, { target: { value: "raw" } });
		fireEvent.submit(search.closest("form")!);
		await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/api/files/list?path=photos&q=raw&scope=all&nodeId=node_1", expect.any(Object)));
	});

	it("searches file contents in the folder on screen and opens a hit's folder", async () => {
		const fetchMock = vi.mocked(globalThis.fetch);
		fetchMock.mockResolvedValueOnce(respondWith({ results: [{ filePath: "/srv/photos/notes.txt", relativePath: "photos/notes/notes.txt", nodeId: "node_1", nodeName: "本机存储", nodeDriver: "LOCAL", snippets: ["hello world"] }], totalMatches: 1, truncated: false }));
		renderWithI18n(<FilesBrowserSpa initialData={baseData} />);
		fireEvent.change(screen.getByLabelText("搜索范围"), { target: { value: "content" } });
		const search = screen.getByRole("searchbox", { name: "搜索文件名" });
		fireEvent.change(search, { target: { value: "hello" } });
		fireEvent.submit(search.closest("form")!);
		expect(await screen.findByText("hello world")).toBeVisible();
		expect(fetchMock.mock.calls[0]![0]).toBe("/api/files/search-content?q=hello&nodeId=node_1&path=photos");
		expect(screen.queryByTestId("file-list")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "photos/notes/notes.txt" }));
		await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith("/api/files/list?path=photos%2Fnotes&nodeId=node_1", expect.any(Object)));
		await waitFor(() => expect(screen.getByTestId("file-list")).toBeInTheDocument());
	});

	it("refreshes the listing when an upload to this node finishes", async () => {
		renderWithI18n(<FilesBrowserSpa initialData={baseData} />);
		expect(screen.getByText("before.jpg")).toBeInTheDocument();
		act(() => {
			window.dispatchEvent(new CustomEvent("storage-upload-completed", { detail: { nodeId: "node_1" } }));
		});
		await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/api/files/list?path=photos&nodeId=node_1", expect.any(Object)));
		await waitFor(() => expect(screen.getByText("after.jpg")).toBeInTheDocument());
	});

	it("keeps the previous list visible when a refresh fails", async () => {
		vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("文件列表刷新失败"));
		renderWithI18n(<FilesBrowserSpa initialData={baseData} />);
		fireEvent.click(screen.getByRole("button", { name: "刷新列表" }));
		await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("文件列表刷新失败"));
		expect(screen.getByText("before.jpg")).toBeInTheDocument();
	});

	it("creates a folder in the folder on screen and refreshes", async () => {
		mocks.createFolder.mockResolvedValue({ success: "已创建" });
		renderWithI18n(<FilesBrowserSpa initialData={baseData} />);
		fireEvent.click(screen.getByRole("button", { name: "新建文件夹" }));
		const dialog = screen.getByRole("dialog", { name: "新建文件夹" });
		fireEvent.change(within(dialog).getByLabelText("文件夹名称"), { target: { value: "2026 旅行" } });
		await act(async () => {
			fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));
		});
		const form = mocks.createFolder.mock.calls[0]![1] as FormData;
		expect([form.get("currentPath"), form.get("storageNodeId"), form.get("folderName")]).toEqual(["photos", "node_1", "2026 旅行"]);
		await waitFor(() => expect(screen.getByText("after.jpg")).toBeInTheDocument());
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("asks where to create a folder when no node is open", async () => {
		renderWithI18n(<FilesBrowserSpa initialData={{ ...baseData, nodeIdFilter: "", currentPath: "", nodes: twoNodes }} />);
		fireEvent.click(screen.getByRole("button", { name: "新建文件夹" }));
		const dialog = screen.getByRole("dialog", { name: "新建文件夹" });
		expect(within(dialog).getByLabelText("目标节点")).toHaveValue("node_1");
		expect(within(dialog).getByRole("option", { name: /香港 VPS · Acme/ })).toBeInTheDocument();
	});

	it("uploads straight into the open folder, and asks for a node at the root", async () => {
		const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
		const { unmount } = renderWithI18n(<FilesBrowserSpa initialData={baseData} />);
		fireEvent.click(screen.getByRole("button", { name: "上传" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "上传文件" }));
		expect(click).toHaveBeenCalledOnce();
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		unmount();
		click.mockRestore();

		renderWithI18n(<FilesBrowserSpa initialData={{ ...baseData, nodeIdFilter: "", currentPath: "", nodes: twoNodes }} />);
		fireEvent.click(screen.getByRole("button", { name: "上传" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "上传文件夹" }));
		expect(await screen.findByRole("button", { name: "模拟上传完成" })).toHaveAttribute("data-initial-node-id", "node_1");
	});

	it("queues dropped files for the open folder", async () => {
		renderWithI18n(<FilesBrowserSpa initialData={baseData} />);
		const drive = document.querySelector("[data-file-browser]")!;
		const dropped = new File(["x"], "dropped.png", { type: "image/png" });
		const dataTransfer = { types: ["Files"], files: [dropped], items: [] };
		fireEvent.dragEnter(drive, { dataTransfer });
		expect(screen.getByText("松开鼠标，上传到 /photos")).toBeInTheDocument();
		await act(async () => {
			fireEvent.drop(drive, { dataTransfer });
		});
		expect(mocks.enqueue).toHaveBeenCalledWith([{ file: dropped, path: "photos/dropped.png" }], "node_1");
		expect(screen.queryByText("松开鼠标，上传到 /photos")).not.toBeInTheDocument();
	});

	it("hands files dropped at the all-locations root to the upload dialog", async () => {
		// The dialog opened to pick a node, but the dropped files were gone.
		renderWithI18n(<FilesBrowserSpa initialData={{ ...baseData, nodeIdFilter: "", currentPath: "", nodes: twoNodes }} />);
		const drive = document.querySelector("[data-file-browser]")!;
		const dropped = new File(["x"], "dropped.png", { type: "image/png" });
		const dataTransfer = { types: ["Files"], files: [dropped], items: [] };
		fireEvent.dragEnter(drive, { dataTransfer });
		await act(async () => {
			fireEvent.drop(drive, { dataTransfer });
		});
		expect(await screen.findByRole("button", { name: "模拟上传完成" })).toHaveAttribute("data-pending-files", "dropped.png");
		expect(mocks.enqueue).not.toHaveBeenCalled();
	});

	it("switches locations from the sidebar and names each node's customer", async () => {
		const fetchMock = vi.mocked(globalThis.fetch);
		fetchMock.mockResolvedValueOnce(respondWith({ ...baseData, nodeIdFilter: "node_sftp_1", currentPath: "", files: [file("r1", "remote.log", { storageNodeDriver: "SFTP" })], nodes: twoNodes }));
		renderWithI18n(<FilesBrowserSpa initialData={{ ...baseData, nodes: twoNodes }} />);
		const locations = screen.getByRole("region", { name: "存储位置" });
		expect(within(locations).getByText("Acme")).toBeInTheDocument();
		fireEvent.click(within(locations).getByRole("button", { name: /香港 VPS/ }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/files/list?nodeId=node_sftp_1", expect.any(Object)));
		await waitFor(() => expect(screen.getByText("remote.log")).toBeInTheDocument());
	});

	it("leaves the customer out when every location belongs to the same one", () => {
		renderWithI18n(<FilesBrowserSpa initialData={{ ...baseData, nodes: [{ id: "node_1", name: "本机存储", driver: "LOCAL", teamName: "平台自用" }] }} />);
		const locations = screen.getByRole("region", { name: "存储位置" });
		expect(within(locations).queryByText("平台自用")).not.toBeInTheDocument();
		// The second line names the kind of location instead.
		expect(within(locations).getByRole("button", { name: /本机存储/ })).toHaveTextContent(/本机存储.*本机/);
	});

	it("filters a long location list", () => {
		const nodes = Array.from({ length: 8 }, (_, index) => ({ id: `n${index}`, name: index === 5 ? "东京归档" : `节点 ${index}`, driver: "SFTP" }));
		renderWithI18n(<FilesBrowserSpa initialData={{ ...baseData, nodes }} />);
		const locations = screen.getByRole("region", { name: "存储位置" });
		fireEvent.change(within(locations).getByRole("searchbox", { name: "搜索存储节点" }), { target: { value: "东京" } });
		expect(within(locations).getAllByRole("listitem")).toHaveLength(1);
		expect(within(locations).getByText("东京归档")).toBeInTheDocument();
	});

	it("blocks upload and folder creation until a location switch finishes", async () => {
		let resolveSwitch!: (value: Response) => void;
		vi.mocked(globalThis.fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveSwitch = resolve; }));
		renderWithI18n(<FilesBrowserSpa initialData={{ ...baseData, nodes: twoNodes }} />);
		fireEvent.click(within(screen.getByRole("region", { name: "存储位置" })).getByRole("button", { name: /香港 VPS/ }));
		await waitFor(() => expect(screen.getByRole("button", { name: "上传" })).toBeDisabled());
		expect(screen.getByRole("button", { name: "新建文件夹" })).toBeDisabled();
		await act(async () => {
			resolveSwitch(respondWith({ ...baseData, currentPath: "", nodeIdFilter: "node_sftp_1", nodes: twoNodes }));
		});
		await waitFor(() => expect(screen.getByRole("button", { name: "上传" })).toBeEnabled());
		expect(screen.getByRole("button", { name: "新建文件夹" })).toBeEnabled();
	});

	it("names the refresh of an SFTP node after the remote and reloads the open folder", async () => {
		const fetchMock = vi.mocked(globalThis.fetch);
		fetchMock.mockResolvedValueOnce(respondWith({ ...baseData, nodeIdFilter: "node_sftp_1", currentPath: "logs", files: [file("f", "fresh.log")], nodes: twoNodes }));
		renderWithI18n(<FilesBrowserSpa initialData={{ ...baseData, nodeIdFilter: "node_sftp_1", currentPath: "logs", nodes: twoNodes }} />);
		fireEvent.click(screen.getByRole("button", { name: "刷新远端文件" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/files/list?path=logs&nodeId=node_sftp_1", expect.any(Object)));
		await waitFor(() => expect(screen.getByText("fresh.log")).toBeInTheDocument());
	});

	it("adds folder visits to browser history and restores prior folders on back navigation", async () => {
		const fetchMock = vi.mocked(globalThis.fetch);
		fetchMock
			.mockResolvedValueOnce(respondWith({ ...baseData, currentPath: "photos/raw", files: [file("file_raw", "raw.nef")] }))
			.mockResolvedValueOnce(respondWith({ ...baseData, currentPath: "photos", files: [file("file_1", "before.jpg")] }));
		const pushStateSpy = vi.spyOn(window.history, "pushState");
		const replaceStateSpy = vi.spyOn(window.history, "replaceState");
		renderWithI18n(<FilesBrowserSpa initialData={baseData} />);
		fireEvent.click(screen.getByRole("button", { name: "raw" }));
		await waitFor(() => expect(screen.getByText("raw.nef")).toBeInTheDocument());
		expect(pushStateSpy).toHaveBeenCalledWith(null, "", "/files?path=photos%2Fraw&nodeId=node_1");
		await act(async () => {
			window.history.pushState(null, "", "/files?path=photos&nodeId=node_1");
			window.dispatchEvent(new PopStateEvent("popstate"));
		});
		await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith("/api/files/list?path=photos&nodeId=node_1&pageSize=100&sort=name&direction=asc&sync=0", expect.any(Object)));
		await waitFor(() => expect(screen.getByText("before.jpg")).toBeInTheDocument());
		expect(replaceStateSpy).not.toHaveBeenCalledWith(null, "", "/files?path=photos&nodeId=node_1");
		pushStateSpy.mockRestore();
		replaceStateSpy.mockRestore();
	});

	it("shows node names instead of internal grouped path keys in the breadcrumbs", () => {
		renderWithI18n(<FilesBrowserSpa initialData={{ ...baseData, nodeIdFilter: "", currentPath: "存储__cmps1rmy/docs", nodes: [{ id: "cmps1rmyabcdef", name: "45.88.1.2", driver: "SFTP" }] }} />);
		const breadcrumbs = screen.getByRole("navigation", { name: "面包屑" });
		expect(within(breadcrumbs).getByText("45.88.1.2")).toBeInTheDocument();
		expect(within(breadcrumbs).getByText("docs")).toHaveAttribute("aria-current", "page");
		expect(screen.queryByText(/存储__cmps1rmy/)).not.toBeInTheDocument();
	});

	it("folds long breadcrumbs and leads back up one level from the fold", async () => {
		renderWithI18n(<FilesBrowserSpa initialData={{ ...baseData, currentPath: "a/b/c/d/e" }} />);
		const breadcrumbs = screen.getByRole("navigation", { name: "面包屑" });
		expect(within(breadcrumbs).queryByRole("button", { name: "b" })).not.toBeInTheDocument();
		fireEvent.click(within(breadcrumbs).getByRole("button", { name: "…" }));
		await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/api/files/list?path=a%2Fb%2Fc&nodeId=node_1", expect.any(Object)));
	});

	it("keeps nested folders in the tree collapsed until expanded", () => {
		renderWithI18n(<FilesBrowserSpa initialData={{ ...baseData, currentPath: "" }} />);
		expect(screen.getByRole("button", { name: "photos" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "raw" })).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "展开 photos" }));
		expect(screen.getByRole("button", { name: "raw" })).toBeInTheDocument();
	});

	it("hides the sidebar behind a toggle on narrow screens", () => {
		renderWithI18n(<FilesBrowserSpa initialData={baseData} />);
		const toggle = screen.getByRole("button", { name: "展开目录树" });
		expect(toggle).toHaveAttribute("aria-expanded", "false");
		expect(toggle).toHaveAttribute("aria-controls", "files-browser-sidebar");
		expectTouchTarget(toggle);
		expect(toggle.className).toMatch(/lg:hidden/);
		const sidebar = document.getElementById("files-browser-sidebar")!;
		expect(sidebar.className.split(/\s+/)).toEqual(expect.arrayContaining(["hidden", "lg:flex"]));
		fireEvent.click(toggle);
		expect(screen.getByRole("button", { name: "收起目录树" })).toHaveAttribute("aria-expanded", "true");
		expect(sidebar.className.split(/\s+/)).not.toContain("hidden");
		fireEvent.click(screen.getByRole("button", { name: "收起目录树" }));
		expect(sidebar.className.split(/\s+/)).toContain("hidden");
	});

	it("closes the narrow-screen sidebar after navigating from the tree", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(respondWith({ ...baseData, currentPath: "photos" }));
		renderWithI18n(<FilesBrowserSpa initialData={{ ...baseData, currentPath: "" }} />);
		fireEvent.click(screen.getByRole("button", { name: "展开目录树" }));
		fireEvent.click(screen.getByRole("button", { name: "photos" }));
		await waitFor(() => expect(screen.getByRole("button", { name: "展开目录树" })).toHaveAttribute("aria-expanded", "false"));
		await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/api/files/list?path=photos&nodeId=node_1", expect.any(Object)));
	});

	it("leaves the recycle bin to the section tabs and does not embed recent downloads", () => {
		renderWithI18n(<FilesBrowserSpa initialData={baseData} />);
		const quick = screen.getByRole("navigation", { name: "快速访问" });
		expect(within(quick).queryByRole("link", { name: /回收站/ })).not.toBeInTheDocument();
		expect(within(quick).getByRole("button", { name: /全部文件/ })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "打开最近下载" })).not.toBeInTheDocument();
	});
});
