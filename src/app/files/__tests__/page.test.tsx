import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const baseStorageOverview = {
 nodes: [
 {
 id: "node_1",
 name: "主控本机",
 driver: "LOCAL",
 isDefault: true,
 connectionSummary: "本机存储：/srv/whrkhldsb/storage",
 directAccess: { mode: "managed-download" as const, description: "本机文件由管理端直接提供受控下载与预览。" },
 fileCount: 2,
 },
 {
 id: "node_2",
 name: "香港媒体库",
 driver: "SFTP",
 isDefault: false,
 connectionSummary: "SFTP 存储：203.0.113.11:22",
 directAccess: { mode: "managed-download" as const, description: "远端文件经管理端 SFTP 代理中转下载（来自 203.0.113.11:22）。", href: "/api/storage/sftp-download?nodeId=node_2&path=" },
 fileCount: 1,
 },
 ],
 entries: [
 {
 id: "file_1",
 name: "notes.txt",
 mimeType: "text/plain",
 relativePath: "docs/notes.txt",
 sizeLabel: "12 B",
 previewable: false,
 localEditable: true,
 directAccess: { mode: "managed-download" as const, description: "本机文件由管理端直接提供受控下载与预览。" },
 storageNode: { id: "node_1", name: "主控本机", driver: "LOCAL" },
 entryType: "FILE" as const,
 },
 {
 id: "file_2",
 name: "demo.mp4",
 mimeType: "video/mp4",
 relativePath: "media/videos/demo.mp4",
 sizeLabel: "1.0 KB",
 previewable: true,
 localEditable: false,
 directAccess: { mode: "managed-download" as const, description: "远端文件经管理端 SFTP 代理中转下载（来自 203.0.113.11:22）。", href: "/api/storage/sftp-download?nodeId=node_2&path=" },
 storageNode: { id: "node_2", name: "香港媒体库", driver: "SFTP" },
 entryType: "FILE" as const,
 },
 ],
 deletedEntries: [] as Array<{ id: string }>,
 remoteDirectories: [
 { storageNodeId: "node_2", storageNodeName: "香港媒体库", storageNodeDriver: "SFTP", path: "media", name: "media", itemCount: 1 },
 { storageNodeId: "node_2", storageNodeName: "香港媒体库", storageNodeDriver: "SFTP", path: "media/videos", name: "videos", itemCount: 1 },
 ],
 stats: {
 totalNodes: 2,
 defaultNodeName: "主控本机",
 localNodeCount: 1,
 sftpNodeCount: 1,
 totalEntries: 2,
 previewableEntries: 1,
 deletedEntries: 0,
 remoteDirectoryCount: 2,
 },
};

const {
 requireSessionMock,
 getStorageOverviewMock,
 listStorageNodesMock,
 refreshMock,
 pushMock,
 replaceMock,
 prefetchMock,
} = vi.hoisted(() => ({
 requireSessionMock: vi.fn().mockResolvedValue({
 userId: "u_1",
 username: "admin",
 roles: ["admin"],
 mustChangePassword: false,
 }),
 getStorageOverviewMock: vi.fn(),
 listStorageNodesMock: vi.fn(),
 refreshMock: vi.fn(),
 pushMock: vi.fn(),
 replaceMock: vi.fn(),
 prefetchMock: vi.fn(),
}));


vi.mock("@/lib/auth/require-session", () => ({
 requireSession: requireSessionMock,
}));

vi.mock("@/lib/storage/service", () => ({
 getStorageOverview: getStorageOverviewMock,
 listStorageNodes: listStorageNodesMock,
}));

vi.mock("@/lib/auth/authorization", () => ({
 sessionHasPermission: vi.fn().mockReturnValue(true),
}));

vi.mock("next/navigation", () => ({
 useRouter: () => ({
 refresh: refreshMock,
 push: pushMock,
 replace: replaceMock,
 prefetch: prefetchMock,
 }),
}));

vi.mock("@/app/storage/actions", () => ({
	getStorageFormOptions: vi.fn().mockResolvedValue({
		servers: [{ id: "srv_1", name: "香港一号", host: "203.0.113.10" }],
		nodes: [
			{ id: "node_1", name: "主控本机", driver: "LOCAL" },
			{ id: "node_2", name: "香港媒体库", driver: "SFTP" },
		],
	}),
	createStorageNodeAction: vi.fn(),
	createFolderAction: vi.fn().mockResolvedValue({ success: "文件夹已创建" }),
	deleteFileEntryAction: vi.fn(),
	restoreFileEntryAction: vi.fn(),
	permanentDeleteFileEntryAction: vi.fn(),
	renameFileEntryAction: vi.fn(),
}));

vi.mock("./create-folder-form", () => ({
 CreateFolderForm: ({ storageNodes, currentPath }: { storageNodes: { id: string; name: string; driver: string }[]; currentPath: string }) => {
 return React.createElement(
 "button",
 {
 type: "button",
 "aria-label": "新建文件夹",
 "data-storage-node-id": storageNodes[0]?.id,
 "data-current-path": currentPath,
 },
 "新建文件夹",
 );
 },
}));

vi.mock("./delete-confirm-button", () => ({
 DeleteConfirmButton: (props: { fileEntryId: string; entryName: string; entryType: string }) => {
 return React.createElement(
 "button",
 { type: "button", "data-testid": "delete-btn", "data-file-entry-id": props.fileEntryId, "data-entry-name": props.entryName },
 "\u5220\u9664 " + props.entryName,
 );
 },
}));

vi.mock("./rename-inline-form", () => ({
 RenameInlineForm: (props: { fileEntryId: string; currentName: string; currentPath: string; entryType: string }) => {
 return React.createElement(
 "button",
 { type: "button", "data-testid": "rename-btn", "data-file-entry-id": props.fileEntryId, "data-current-name": props.currentName },
 "\u91CD\u547D\u540D " + props.currentName,
 );
 },
}));

vi.mock("./move-inline-form", () => ({
 MoveInlineForm: (props: { fileEntryId: string; name: string; relativePath: string; storageNodeId: string; storageNodeName: string }) => {
 return React.createElement(
 "button",
 { type: "button", "data-testid": "move-btn", "data-file-entry-id": props.fileEntryId, "data-name": props.name },
 "\u79FB\u52A8 " + props.name,
 );
 },
}));

vi.mock("./restore-button", () => ({
 RestoreButton: (props: { fileEntryId: string; entryName: string }) => {
 return React.createElement(
 "button",
 { type: "submit", "data-testid": "restore-btn", "data-file-entry-id": props.fileEntryId, "data-entry-name": props.entryName },
 "\u6062\u590D " + props.entryName,
 );
 },
}));

vi.mock("./permanent-delete-button", () => ({
 PermanentDeleteButton: (props: { fileEntryId: string; entryName: string }) => {
 return React.createElement(
 "button",
 { type: "button", "data-testid": "permanent-delete-btn", "data-file-entry-id": props.fileEntryId, "data-entry-name": props.entryName },
 "\u6C38\u4E45\u5220\u9664 " + props.entryName,
 );
 },
}));

import FilesPage from "../page";

beforeEach(() => {
 getStorageOverviewMock.mockResolvedValue(structuredClone(baseStorageOverview));
 listStorageNodesMock.mockResolvedValue(structuredClone(baseStorageOverview.nodes));
});

describe("FilesPage", () => {
 it("renders directory browsing and downloads in a cloud-drive style layout", async () => {
 render(await FilesPage({ searchParams: Promise.resolve({ path: "docs", nodeId: "node_1" }) }));

 expect(screen.getByRole("heading", { name: "文件与存储管理" })).toBeInTheDocument();
 expect(screen.getAllByRole("button", { name: "全部文件" }).length).toBeGreaterThan(0);
 expect(screen.getByRole("button", { name: "docs" })).toBeInTheDocument();
 expect(screen.getAllByRole("link", { name: "下载 notes.txt" })[0]).toHaveAttribute(
 "href",
 "/api/storage/local?path=docs%2Fnotes.txt&download=1",
 );
	expect(screen.getByRole("heading", { name: /回收站/ })).toBeInTheDocument();
 });

 it("shows a drive-style toolbar with search, upload, and folder creation", async () => {
 render(await FilesPage({ searchParams: Promise.resolve({ path: "docs", nodeId: "node_1" }) }));

 expect(screen.getByRole("heading", { name: "当前目录操作" })).toBeInTheDocument();
 expect(screen.getByRole("link", { name: "⬆ 上传文件" })).toBeInTheDocument();
 expect(screen.getByRole("button", { name: "新建文件夹" })).not.toBeDisabled();
 expect(screen.getByPlaceholderText("搜索当前目录文件名…")).toBeInTheDocument();
 expect(screen.getAllByText(/主控本机/).length).toBeGreaterThan(0);
 expect(screen.getByRole("link", { name: "⬆ 上传文件" })).toHaveAttribute("href", "#upload-section");
 });

 it("renders delete and rename buttons for files when user has permissions", async () => {
 render(await FilesPage({ searchParams: Promise.resolve({ path: "docs", nodeId: "node_1" }) }));

	expect(screen.getAllByRole("link", { name: "下载 notes.txt" }).length).toBeGreaterThan(0);
 const deleteButtons = screen.queryAllByTestId("delete-btn");
 const renameButtons = screen.queryAllByTestId("rename-btn");
	if (deleteButtons.length === 0) {
		const allButtons = screen.getAllByRole("button");
		expect(allButtons.some((btn) => btn.getAttribute("title") === "删除" || btn.textContent?.includes("删除"))).toBe(true);
		expect(allButtons.some((btn) => btn.getAttribute("title") === "重命名" || btn.textContent?.includes("重命名"))).toBe(true);
	} else {
 expect(deleteButtons.some((btn) => btn.getAttribute("data-entry-name") === "notes.txt")).toBe(true);
 expect(renameButtons.some((btn) => btn.getAttribute("data-current-name") === "notes.txt")).toBe(true);
 }
 });

 it("renders remote registered directories in the tree and file list", async () => {
 getStorageOverviewMock.mockResolvedValue({
 ...structuredClone(baseStorageOverview),
 entries: [
 {
 id: "file_9",
 name: "release.zip",
 mimeType: "application/zip",
 relativePath: "archives/releases/release.zip",
 sizeLabel: "4.0 KB",
 previewable: false,
 localEditable: false,
 directAccess: { mode: "managed-download" as const, description: "远端文件经管理端 SFTP 代理中转下载（来自 203.0.113.11:22）。", href: "/api/storage/sftp-download?nodeId=node_2&path=" },
 storageNode: { id: "node_2", name: "香港媒体库", driver: "SFTP" },
 entryType: "FILE" as const,
 },
 ],
 remoteDirectories: [
 { storageNodeId: "node_2", storageNodeName: "香港媒体库", storageNodeDriver: "SFTP", path: "archives", name: "archives", itemCount: 1 },
 { storageNodeId: "node_2", storageNodeName: "香港媒体库", storageNodeDriver: "SFTP", path: "archives/releases", name: "releases", itemCount: 1 },
 ],
 stats: {
 ...baseStorageOverview.stats,
 totalEntries: 1,
 previewableEntries: 0,
 remoteDirectoryCount: 2,
 },
 });

 render(await FilesPage({ searchParams: Promise.resolve({ path: "archives" }) }));

 expect(screen.getByRole("button", { name: "archives" })).toBeInTheDocument();
 expect(screen.getByRole("button", { name: "releases" })).toBeInTheDocument();
 expect(screen.getAllByText(/当前路径：\/archives/)[0]).toBeInTheDocument();
 expect(screen.getAllByRole("button", { name: "打开" }).length).toBeGreaterThan(0);
 });

 it("shows remote directory source summary in the toolbar", async () => {
 getStorageOverviewMock.mockResolvedValue({
 ...structuredClone(baseStorageOverview),
 entries: [
 {
 id: "dir_10",
 name: "archives",
 mimeType: "inode/directory",
 relativePath: "archives",
 sizeLabel: "-",
 previewable: false,
 localEditable: false,
 directAccess: { mode: "managed-download" as const, description: "远端文件经管理端 SFTP 代理中转下载（来自 203.0.113.11:22）。", href: "/api/storage/sftp-download?nodeId=node_2&path=" },
 storageNode: { id: "node_2", name: "香港媒体库", driver: "SFTP" },
 entryType: "DIRECTORY" as const,
 },
 ],
 remoteDirectories: [
 { storageNodeId: "node_2", storageNodeName: "香港媒体库", storageNodeDriver: "SFTP", path: "archives", name: "archives", itemCount: 1 },
 { storageNodeId: "node_2", storageNodeName: "香港媒体库", storageNodeDriver: "SFTP", path: "archives/releases", name: "releases", itemCount: 1 },
 ],
 stats: {
 ...baseStorageOverview.stats,
 totalEntries: 1,
 previewableEntries: 0,
 remoteDirectoryCount: 2,
 },
 });

 render(await FilesPage({ searchParams: Promise.resolve({ path: "archives" }) }));

 expect(screen.getAllByText(/香港媒体库/).length).toBeGreaterThan(0);
 expect(screen.getByText(/项目数 1/)).toBeInTheDocument();
 expect(screen.getAllByRole("button", { name: "打开" }).length).toBeGreaterThan(0);
 });

 it("renders recycle bin section showing deleted entries count", async () => {
 getStorageOverviewMock.mockResolvedValue({
 ...structuredClone(baseStorageOverview),
 deletedEntries: [
 {
 id: "del_1",
 name: "old-file.txt",
 entryType: "FILE",
 mimeType: "text/plain",
 relativePath: "docs/old-file.txt",
 size: BigInt(256),
 sizeLabel: "256 B",
 storageNode: { id: "node_1", name: "主控本机", driver: "LOCAL" },
 },
 ],
 stats: {
 ...baseStorageOverview.stats,
 deletedEntries: 1,
 },
 });

	render(await FilesPage({ searchParams: Promise.resolve({}) }));

	expect(screen.getByRole("heading", { name: /回收站/ })).toBeInTheDocument();
	const restoreBtns = screen.queryAllByTestId("restore-btn");
	const permanentDeleteBtns = screen.queryAllByTestId("permanent-delete-btn");
	if (restoreBtns.length === 0) {
		const allButtons = screen.getAllByRole("button");
		expect(allButtons.some((btn) => btn.textContent?.includes("恢复"))).toBe(true);
		expect(allButtons.some((btn) => btn.textContent?.includes("永久删除"))).toBe(true);
	} else {
		expect(restoreBtns.some((btn) => btn.getAttribute("data-entry-name") === "old-file.txt")).toBe(true);
		expect(permanentDeleteBtns.some((btn) => btn.getAttribute("data-entry-name") === "old-file.txt")).toBe(true);
	}
});
});
