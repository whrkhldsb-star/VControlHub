import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FileListClient, type FileProp, type FolderProp } from "../file-list-client";

const pushMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());
const deleteFileEntryActionMock = vi.hoisted(() => vi.fn());
const moveFileActionMock = vi.hoisted(() => vi.fn());

function firstFileCheckbox(name: string) {
  return screen.getAllByLabelText(`选择 ${name}`)[0];
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}));

vi.mock("../delete-confirm-button", () => ({
  DeleteConfirmButton: (props: { fileEntryId: string; entryName: string }) =>
    React.createElement("button", { type: "button", "data-testid": "delete-btn", "data-file-entry-id": props.fileEntryId }, `删除 ${props.entryName}`),
}));

vi.mock("../rename-inline-form", () => ({
  RenameInlineForm: (props: { fileEntryId: string; currentName: string; entryType: string }) =>
    React.createElement(
      "button",
      { type: "button", "data-testid": "rename-btn", "data-entry-type": props.entryType, "data-file-entry-id": props.fileEntryId },
      `重命名 ${props.currentName}`,
    ),
}));

vi.mock("../move-inline-form", () => ({
  MoveInlineForm: (props: { fileEntryId: string; name: string }) =>
    React.createElement("button", { type: "button", "data-testid": "move-btn", "data-file-entry-id": props.fileEntryId }, `移动 ${props.name}`),
}));

vi.mock("../share-file-button", () => ({
  ShareFileButton: (props: { entry: { id: string; name: string }; compact?: boolean }) =>
    React.createElement(
      "button",
      { type: "button", "data-testid": "share-btn", "data-file-entry-id": props.entry.id },
      props.compact ? "分享" : `分享 ${props.entry.name}`,
    ),
}));

vi.mock("../../storage/actions", () => ({
  deleteFileEntryAction: deleteFileEntryActionMock,
}));

vi.mock("../move-file-action", () => ({
  moveFileAction: moveFileActionMock,
}));

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

const directoryFile: FileProp = {
  ...imageFile,
  id: "dir_duplicate",
  name: "photos",
  entryType: "DIRECTORY",
  mimeType: null,
  relativePath: "photos",
  previewable: false,
  sizeLabel: "-",
};

const directoryMimeFile: FileProp = {
  ...directoryFile,
  id: "dir_mime_duplicate",
  entryType: "FILE",
  mimeType: "inode/directory",
};

function renderFileList(overrides: Partial<React.ComponentProps<typeof FileListClient>> = {}) {
  return render(
    <FileListClient
      folders={overrides.folders ?? [folder]}
      files={overrides.files ?? [imageFile]}
      canEditLocalFiles={overrides.canEditLocalFiles ?? true}
      canDelete={overrides.canDelete ?? true}
      canShare={overrides.canShare ?? false}
      currentPath={overrides.currentPath ?? ""}
      searchQuery={overrides.searchQuery ?? ""}
      selectionScopeSeed={overrides.selectionScopeSeed ?? `${overrides.currentPath ?? ""}\u0000${overrides.searchQuery ?? ""}`}
      onFolderClick={overrides.onFolderClick ?? vi.fn()}
      onRefresh={overrides.onRefresh ?? vi.fn()}
    />,
  );
}

describe("FileListClient", () => {
  beforeEach(() => {
    window.localStorage.clear();
    pushMock.mockClear();
    refreshMock.mockClear();
    deleteFileEntryActionMock.mockReset().mockResolvedValue({ success: "ok" });
    moveFileActionMock.mockReset().mockResolvedValue({ success: "ok" });
  });

  it("renders thumbnail background only for files and never as a folder overlay", () => {
    window.localStorage.setItem("app-file-view-mode", "grid");

    const { container } = renderFileList();

    expect(screen.getByRole("button", { name: /photos/ })).toBeInTheDocument();
    expect(container.querySelector('[data-testid="folder-thumbnail-overlay"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="file-thumbnail-overlay"] img')).toHaveAttribute(
      "src",
      "/api/storage/local?path=photos%2Fcover.jpg&nodeId=node_1",
    );
  });

  it("renders folder entries only once when directory entries also arrive in the files payload", () => {
    window.localStorage.setItem("app-file-view-mode", "grid");

    renderFileList({ files: [directoryFile, directoryMimeFile, imageFile] });

    expect(screen.getAllByTestId("folder-card")).toHaveLength(1);
    expect(screen.queryByText("-")).not.toBeInTheDocument();
    expect(screen.getByText("cover.jpg")).toBeInTheDocument();
  });

  it("excludes hidden directory payload entries from batch selection", () => {
    renderFileList({ files: [directoryFile, directoryMimeFile, imageFile] });

    fireEvent.click(screen.getByLabelText("全选文件"));

    expect(screen.getByText("已选 1 个文件")).toBeInTheDocument();
    expect(firstFileCheckbox("cover.jpg")).toBeChecked();
  });

  it("persists the selected file view mode and restores it on next render", () => {
    renderFileList();

    const gridButton = screen.getByRole("button", { name: "图标视图" });
    fireEvent.click(gridButton);

    expect(window.localStorage.getItem("app-file-view-mode")).toBe("grid");
    expect(gridButton).toHaveAttribute("aria-pressed", "true");

    renderFileList();
    expect(screen.getAllByRole("button", { name: "图标视图" })[1]).toHaveAttribute("aria-pressed", "true");
  });

  it("renders the table view without the type column so headers match row cells", () => {
    const { container } = renderFileList();

    expect(screen.getByText("名称")).toBeInTheDocument();
    expect(screen.getByText("大小")).toBeInTheDocument();
    expect(screen.getByText("来源")).toBeInTheDocument();
    expect(screen.getByText("修改时间")).toBeInTheDocument();
    expect(screen.queryByText("类型")).not.toBeInTheDocument();
    expect(screen.queryByText("image/jpeg")).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="file-table-scroll"]')).toHaveClass("overflow-x-auto");
    expect(container.querySelector('[data-testid="file-table-inner"]')).toHaveClass("min-w-[1180px]");
  });

  it("sorts by numeric file size instead of formatted labels", () => {
    renderFileList({ files: [imageFile, archiveFile, docFile], folders: [] });

    fireEvent.click(screen.getByRole("button", { name: "按大小排序" }));

    const table = screen.getByTestId("file-table-inner");
    const fileNames = Array.from(table.querySelectorAll("a.truncate.font-medium"))
      .map((node) => node.textContent)
      .filter((name): name is string => Boolean(name));
    expect(fileNames.slice(0, 3)).toEqual(["report.pdf", "cover.jpg", "archive.zip"]);
  });

  it("clears effective selection when path or search filters change while preserving sort state", () => {
    const { rerender } = render(
      <FileListClient
        folders={[]}
        files={[imageFile, archiveFile, docFile]}
        canEditLocalFiles={true}
        canDelete={true}
        currentPath="photos"
        searchQuery=""
        selectionScopeSeed="photos\u0000"
        onFolderClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "按大小排序" }));
    fireEvent.click(firstFileCheckbox("cover.jpg"));
    expect(screen.getByText("· 已选 1 个")).toBeInTheDocument();

    rerender(
      <FileListClient
        folders={[]}
        files={[docFile]}
        canEditLocalFiles={true}
        canDelete={true}
        currentPath="docs"
        searchQuery="report"
        selectionScopeSeed="docs\u0000report"
        onFolderClick={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.queryByText(/已选/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "按大小排序" })).toHaveTextContent("↑");
    expect(screen.getAllByRole("link", { name: "report.pdf" })[0]).toBeInTheDocument();
  });

  it("renders one effective attachment-capable download action instead of website and direct choices", () => {
    renderFileList({ files: [sftpDirectFile], folders: [] });

    expect(screen.queryByText("下载流量")).not.toBeInTheDocument();
    expect(screen.queryByText("网站")).not.toBeInTheDocument();
    expect(screen.queryByText("直连")).not.toBeInTheDocument();
    const downloadLinks = screen.getAllByRole("link", { name: "下载 movie.mp4" });
    expect(downloadLinks[0]).toHaveAttribute(
      "href",
      "/api/storage/sftp-download?nodeId=node_sftp&path=media%2Fmovie.mp4&download=1",
    );
    expect(downloadLinks[0]).toHaveAttribute("download");
    expect(downloadLinks[0]).not.toHaveAttribute("target");
  });

  it("renders archive download actions for readable folders", () => {
    renderFileList({ files: [], folders: [folder] });

    expect(screen.getAllByRole("link", { name: "下载目录 photos" })[0]).toHaveAttribute(
      "href",
      "/api/storage/archive-download?nodeId=node_1&path=photos",
    );
  });

  it("opens an asset detail panel that consolidates preview, download, share, and media actions", () => {
    renderFileList({ files: [imageFile], folders: [], canShare: true });

    fireEvent.click(screen.getAllByRole("button", { name: "资料详情 cover.jpg" })[0]);

    const dialog = screen.getByRole("dialog", { name: "cover.jpg" });
    expect(dialog).toHaveTextContent("资料详情");
    expect(dialog).toHaveTextContent("photos/cover.jpg");
    expect(dialog).toHaveTextContent("本机存储");
    expect(screen.getByRole("link", { name: "预览 / 在线编辑" })).toHaveAttribute(
      "href",
      expect.stringContaining("/files/preview?"),
    );
    expect(screen.getByRole("link", { name: "下载文件" })).toHaveAttribute(
      "href",
      "/api/storage/local?path=photos%2Fcover.jpg&nodeId=node_1&download=1",
    );
    expect(screen.getByRole("link", { name: "在媒体库中查找" })).toHaveAttribute(
      "href",
      "/media?q=cover.jpg&type=image",
    );
    expect(screen.getAllByTestId("share-btn").some((button) => button.textContent === "分享 cover.jpg")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog", { name: "cover.jpg" })).not.toBeInTheDocument();
  });

  it("hides detail panel actions when entry read permission is denied", () => {
    renderFileList({
      files: [
        {
          ...imageFile,
          storageNodeDriver: "SFTP",
          capabilities: { canRead: false, canWrite: false, canDelete: false },
        },
      ],
      folders: [],
      canShare: true,
    });

    fireEvent.click(screen.getAllByRole("button", { name: "资料详情 cover.jpg" })[0]);

    expect(screen.getByRole("dialog", { name: "cover.jpg" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "预览 / 在线编辑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "下载文件" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "在媒体库中查找" })).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("share-btn")).toHaveLength(0);
  });

  it("hides preview, download, delete, and batch selection when entry capabilities deny access", () => {
    renderFileList({
      files: [
        {
          ...imageFile,
          storageNodeDriver: "SFTP",
          capabilities: { canRead: false, canWrite: false, canDelete: false },
        },
      ],
    });

    expect(screen.queryByRole("link", { name: /cover\.jpg/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("选择 cover.jpg")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("delete-btn")).toHaveLength(0);
    fireEvent.click(screen.getByLabelText("全选文件"));
    expect(screen.queryByText(/已选/)).not.toBeInTheDocument();
  });

  it("uses per-entry capabilities for batch actions", () => {
    renderFileList({
      files: [
        { ...imageFile, capabilities: { canRead: true, canWrite: true, canDelete: false } },
        { ...archiveFile, capabilities: { canRead: true, canWrite: false, canDelete: true } },
      ],
    });

    fireEvent.click(firstFileCheckbox("cover.jpg"));
    expect(screen.getByRole("button", { name: "批量移动" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批量删除" })).not.toBeInTheDocument();

    fireEvent.click(firstFileCheckbox("archive.zip"));
    expect(screen.queryByRole("button", { name: "批量移动" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批量删除" })).not.toBeInTheDocument();
  });

  it("keeps batch delete selection open and reports per-file failures", async () => {
    const onRefresh = vi.fn();
    deleteFileEntryActionMock
      .mockResolvedValueOnce({ success: "ok" })
      .mockResolvedValueOnce({ error: "节点不可写" });

    renderFileList({ files: [imageFile, archiveFile], onRefresh });

    fireEvent.click(firstFileCheckbox("cover.jpg"));
    fireEvent.click(firstFileCheckbox("archive.zip"));
    fireEvent.click(screen.getByRole("button", { name: "批量删除" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(deleteFileEntryActionMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("alert", { name: /批量操作完成/ })).toBeInTheDocument());
    expect(screen.getByRole("region", { name: "文件批量操作" })).toHaveAccessibleDescription(
      "已选择 2 个文件，可取消选择或执行当前权限允许的批量操作。",
    );
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("已选 2 个文件")).toBeInTheDocument();
    expect(screen.getByText(/节点不可写/)).toBeInTheDocument();
  });

  it("keeps batch move selection open and reports per-file failures", async () => {
    const onRefresh = vi.fn();
    moveFileActionMock
      .mockResolvedValueOnce({ success: "ok" })
      .mockResolvedValueOnce({ error: "目标目录不存在" })
      .mockResolvedValueOnce({ success: "ok" });

    renderFileList({ files: [imageFile, archiveFile, docFile], onRefresh });

    fireEvent.click(firstFileCheckbox("cover.jpg"));
    fireEvent.click(firstFileCheckbox("archive.zip"));
    fireEvent.click(firstFileCheckbox("report.pdf"));
    fireEvent.click(screen.getByRole("button", { name: "批量移动" }));
    fireEvent.change(screen.getByRole("textbox", { name: "批量移动目标路径" }), { target: { value: "archive" } });
    fireEvent.click(screen.getByRole("button", { name: "确认移动" }));

    await waitFor(() => expect(moveFileActionMock).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByRole("alert", { name: /批量操作完成/ })).toBeInTheDocument());
    expect(screen.getByRole("region", { name: "文件批量操作" })).toHaveAccessibleDescription(
      "已选择 3 个文件，可取消选择或执行当前权限允许的批量操作。",
    );
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("已选 3 个文件")).toBeInTheDocument();
    expect(screen.getByText(/archive\.zip: 目标目录不存在/)).toBeInTheDocument();
  });

  it("drops stale batch UI when the selection scope seed changes", async () => {
    const onRefresh = vi.fn();
    deleteFileEntryActionMock.mockResolvedValueOnce({ error: "节点不可写" });
    const { rerender } = render(
      <FileListClient
        folders={[]}
        files={[imageFile]}
        canEditLocalFiles={true}
        canDelete={true}
        currentPath="photos"
        searchQuery=""
        selectionScopeSeed="epoch0\u0000photos\u0000"
        onFolderClick={vi.fn()}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(firstFileCheckbox("cover.jpg"));
    fireEvent.click(screen.getByRole("button", { name: "批量删除" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(deleteFileEntryActionMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("alert", { name: /批量操作完成/ })).toBeInTheDocument());
    expect(screen.getByText(/节点不可写/)).toBeInTheDocument();

    rerender(
      <FileListClient
        folders={[]}
        files={[docFile]}
        canEditLocalFiles={true}
        canDelete={true}
        currentPath="photos"
        searchQuery=""
        selectionScopeSeed="epoch1\u0000photos\u0000"
        onFolderClick={vi.fn()}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.queryByRole("region", { name: "文件批量操作" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert", { name: /批量操作完成/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/节点不可写/)).not.toBeInTheDocument();
  });

});
