import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FileListClient, type FileProp, type FolderProp } from "../file-list-client";

const pushMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());
const deleteFileEntryActionMock = vi.hoisted(() => vi.fn());
const moveFileActionMock = vi.hoisted(() => vi.fn());

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
  directAccessHref: "/api/storage/local?path=photos%2Freport.pdf",
  updatedAt: "2026-05-06T00:00:00.000Z",
};

function renderFileList(overrides: Partial<React.ComponentProps<typeof FileListClient>> = {}) {
  return render(
    <FileListClient
      folders={overrides.folders ?? [folder]}
      files={overrides.files ?? [imageFile]}
      canEditLocalFiles={overrides.canEditLocalFiles ?? true}
      canDelete={overrides.canDelete ?? true}
      currentPath={overrides.currentPath ?? ""}
      searchQuery={overrides.searchQuery ?? ""}
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
      "/api/storage/local?path=photos%2Fcover.jpg",
    );
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

  it("lets users choose website proxy or target-server direct traffic for downloads", () => {
    renderFileList({ files: [sftpDirectFile] });

    expect(screen.getAllByText(/下载流量/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "经网站服务器下载 movie.mp4" })[0]).toHaveAttribute(
      "href",
      "/api/storage/sftp-download?nodeId=node_sftp&path=media%2Fmovie.mp4&download=1",
    );
    expect(screen.getAllByRole("link", { name: "直连目标服务器下载 movie.mp4" })[0]).toHaveAttribute(
      "href",
      "https://cdn.example.com/media/movie.mp4?signature=abc",
    );
  });

  it("keeps batch delete selection open and reports per-file failures", async () => {
    const onRefresh = vi.fn();
    deleteFileEntryActionMock
      .mockResolvedValueOnce({ success: "ok" })
      .mockResolvedValueOnce({ error: "节点不可写" });

    renderFileList({ files: [imageFile, archiveFile], onRefresh });

    fireEvent.click(screen.getByLabelText("选择 cover.jpg"));
    fireEvent.click(screen.getByLabelText("选择 archive.zip"));
    fireEvent.click(screen.getByRole("button", { name: "批量删除" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(deleteFileEntryActionMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(/1 个失败/)).toBeInTheDocument());
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

    fireEvent.click(screen.getByLabelText("选择 cover.jpg"));
    fireEvent.click(screen.getByLabelText("选择 archive.zip"));
    fireEvent.click(screen.getByLabelText("选择 report.pdf"));
    fireEvent.click(screen.getByRole("button", { name: "批量移动" }));
    fireEvent.change(screen.getByPlaceholderText("目标路径"), { target: { value: "archive" } });
    fireEvent.click(screen.getByRole("button", { name: "确认移动" }));

    await waitFor(() => expect(moveFileActionMock).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByText(/1 个失败/)).toBeInTheDocument());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("已选 3 个文件")).toBeInTheDocument();
    expect(screen.getByText(/archive\.zip: 目标目录不存在/)).toBeInTheDocument();
  });

});
