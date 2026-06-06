import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FilesBrowserSpa } from "../files-browser-spa";

const pushMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("@/components/storage/file-upload-dropzone", () => ({
  FileUploadDropzone: (props: {
    nodes?: Array<{ id: string; driver: string }>;
    initialNodeId?: string;
    onUploadComplete?: () => void;
  }) =>
    React.createElement(
      "button",
      {
        type: "button",
        onClick: () => props.onUploadComplete?.(),
        "data-upload-node-count": props.nodes?.length ?? 0,
        "data-initial-node-id": props.initialNodeId ?? "",
      },
      "模拟上传完成",
    ),
}));

vi.mock("../search-scope-toggle", () => ({
  SearchScopeToggle: () => React.createElement("span", null, "搜索范围"),
}));

vi.mock("../create-folder-form", () => ({
  CreateFolderForm: (props: {
    initialNodeId?: string;
    onCreated?: () => void;
  }) =>
    React.createElement(
      "button",
      {
        type: "button",
        onClick: () => props.onCreated?.(),
        "data-initial-node-id": props.initialNodeId ?? "",
      },
      "新建文件夹",
    ),
}));

vi.mock("../recycle-bin-section-client", () => ({
  RecycleBinSectionClient: () => React.createElement("div", null, "回收站"),
}));

vi.mock("../file-list-client", () => ({
  FileListClient: (props: { files: Array<{ name: string }> }) =>
    React.createElement(
      "div",
      { "data-testid": "file-list" },
      props.files.map((file) =>
        React.createElement("span", { key: file.name }, file.name),
      ),
    ),
}));

const baseData = {
  currentPath: "photos",
  nodeIdFilter: "node_1",
  folders: [],
  files: [
    {
      id: "file_1",
      name: "before.jpg",
      entryType: "FILE",
      mimeType: "image/jpeg",
      relativePath: "photos/before.jpg",
      sizeLabel: "10 KB",
      previewable: true,
      directAccessMode: "managed-download",
      directAccessHref: "/api/storage/local?path=photos%2Fbefore.jpg",
      directAccessDescription: "受控下载",
      storageNodeId: "node_1",
      storageNodeName: "本机存储",
      storageNodeDriver: "LOCAL",
      updatedAt: "2026-05-04T00:00:00.000Z",
    },
  ],
  tree: {
    name: "root",
    path: "",
    children: [
      {
        name: "photos",
        path: "photos",
        fileCount: 1,
        folderCount: 1,
        sourceKeys: [],
        sourceValues: [],
        children: [
          {
            name: "raw",
            path: "photos/raw",
            fileCount: 2,
            folderCount: 0,
            sourceKeys: [],
            sourceValues: [],
            children: [],
          },
        ],
      },
    ],
  },
  stats: {
    totalNodes: 1,
    defaultNodeName: "本机存储",
    localNodeCount: 1,
    sftpNodeCount: 0,
    totalEntries: 1,
    previewableEntries: 1,
    deletedEntries: 0,
    remoteDirectoryCount: 0,
    totalItems: 1,
  },
  sourceSummary: ["本机存储"],
  searchQuery: "",
  searchScope: "current" as const,
  permissions: {
    canEditLocalFiles: true,
    canDelete: true,
    canManageNodes: true,
  },
  nodes: [{ id: "node_1", name: "本机存储", driver: "LOCAL" }],
};

describe("FilesBrowserSpa", () => {
  beforeEach(() => {
    pushMock.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...baseData,
          files: [
            {
              ...baseData.files[0],
              id: "file_2",
              name: "after.jpg",
              relativePath: "photos/after.jpg",
            },
          ],
        }),
      }),
    );
  });

  it("refreshes the SPA file list after upload completes", async () => {
    render(
      <FilesBrowserSpa
        initialData={baseData}
        deletedEntries={[]}
      />,
    );

    expect(screen.getByText("before.jpg")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "模拟上传完成" }));

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/files/list?path=photos&nodeId=node_1",
        expect.any(Object),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("after.jpg")).toBeInTheDocument(),
    );
  });

  it("surfaces list refresh failures inline and keeps the previous file list visible", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(
      new Error("文件列表刷新失败"),
    );

    render(
      <FilesBrowserSpa
        initialData={baseData}
        deletedEntries={[]}
      />,
    );
    expect(screen.getByText("before.jpg")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "模拟上传完成" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("文件列表刷新失败"),
    );
    expect(screen.getByText("before.jpg")).toBeInTheDocument();
  });

  it("refreshes the SPA file list after create-folder succeeds", async () => {
    render(
      <FilesBrowserSpa
        initialData={baseData}
        deletedEntries={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "新建文件夹" }));

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/files/list?path=photos&nodeId=node_1",
        expect.any(Object),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("after.jpg")).toBeInTheDocument(),
    );
  });

  it("defaults create-folder and upload targets to the currently selected storage node", () => {
    render(
      <FilesBrowserSpa
        initialData={{
          ...baseData,
          nodeIdFilter: "node_sftp_1",
          nodes: [
            { id: "node_1", name: "本机存储", driver: "LOCAL" },
            { id: "node_sftp_1", name: "香港 VPS", driver: "SFTP" },
          ],
        }}
        deletedEntries={[]}
      />,
    );

    expect(screen.getByRole("button", { name: "新建文件夹" })).toHaveAttribute(
      "data-initial-node-id",
      "node_sftp_1",
    );
    expect(screen.getByRole("button", { name: "模拟上传完成" })).toHaveAttribute(
      "data-initial-node-id",
      "node_sftp_1",
    );
  });

  it("filters storage nodes before switching the file browser node", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...baseData,
        nodeIdFilter: "node_sftp_2",
        currentPath: "",
        files: [],
        nodes: [
          { id: "node_1", name: "本机存储", driver: "LOCAL" },
          { id: "node_sftp_1", name: "香港 VPS", driver: "SFTP" },
          { id: "node_sftp_2", name: "东京归档", driver: "SFTP" },
        ],
      }),
    } as Response);
    render(
      <FilesBrowserSpa
        initialData={{
          ...baseData,
          nodes: [
            { id: "node_1", name: "本机存储", driver: "LOCAL" },
            { id: "node_sftp_1", name: "香港 VPS", driver: "SFTP" },
            { id: "node_sftp_2", name: "东京归档", driver: "SFTP" },
          ],
        }}
        deletedEntries={[]}
      />,
    );

    const sidebarSearch =
      screen.getAllByPlaceholderText("搜索节点名称、类型或 ID")[0];
    const sidebarSelect = screen.getAllByLabelText("选择存储节点")[0];
    fireEvent.change(sidebarSearch, { target: { value: "东京" } });
    expect(
      within(sidebarSelect).getByRole("option", { name: /东京归档/ }),
    ).toBeInTheDocument();
    expect(
      within(sidebarSelect).queryByRole("option", { name: /香港 VPS/ }),
    ).not.toBeInTheDocument();

    fireEvent.change(sidebarSelect, { target: { value: "node_sftp_2" } });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/files/list?nodeId=node_sftp_2",
        expect.any(Object),
      ),
    );
  });

  it("uses the unified file list for SFTP nodes instead of rendering a separate SFTP browser", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...baseData,
        currentPath: "",
        nodeIdFilter: "node_sftp_1",
        files: [
          {
            ...baseData.files[0],
            id: "file_sftp_1",
            name: "remote.log",
            relativePath: "remote.log",
            storageNodeId: "node_sftp_1",
            storageNodeName: "香港 VPS",
            storageNodeDriver: "SFTP",
          },
        ],
        nodes: [
          { id: "node_1", name: "本机存储", driver: "LOCAL" },
          { id: "node_sftp_1", name: "香港 VPS", driver: "SFTP" },
        ],
      }),
    } as Response);

    render(
      <FilesBrowserSpa
        initialData={{
          ...baseData,
          nodes: [
            { id: "node_1", name: "本机存储", driver: "LOCAL" },
            { id: "node_sftp_1", name: "香港 VPS", driver: "SFTP" },
          ],
        }}
        deletedEntries={[]}
      />,
    );

    expect(screen.queryByText("SFTP 远端浏览")).not.toBeInTheDocument();
    fireEvent.change(screen.getAllByLabelText("选择存储节点")[0], {
      target: { value: "node_sftp_1" },
    });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/files/list?nodeId=node_sftp_1",
        expect.any(Object),
      ),
    );
    await waitFor(() => expect(screen.getByText("remote.log")).toBeInTheDocument());
  });

  it("renders an explicit remote refresh button for SFTP nodes and reloads the current path", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...baseData,
        nodeIdFilter: "node_sftp_1",
        currentPath: "logs",
        files: [
          {
            ...baseData.files[0],
            id: "file_fresh",
            name: "fresh.log",
            relativePath: "logs/fresh.log",
            storageNodeId: "node_sftp_1",
            storageNodeName: "45.88.1.2",
            storageNodeDriver: "SFTP",
          },
        ],
        nodes: [
          { id: "node_1", name: "本机存储", driver: "LOCAL" },
          { id: "node_sftp_1", name: "45.88.1.2", driver: "SFTP" },
        ],
      }),
    } as Response);

    render(
      <FilesBrowserSpa
        initialData={{
          ...baseData,
          nodeIdFilter: "node_sftp_1",
          currentPath: "logs",
          nodes: [
            { id: "node_1", name: "本机存储", driver: "LOCAL" },
            { id: "node_sftp_1", name: "45.88.1.2", driver: "SFTP" },
          ],
        }}
        deletedEntries={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "↻ 刷新远端文件" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/files/list?path=logs&nodeId=node_sftp_1",
        expect.any(Object),
      ),
    );
    await waitFor(() => expect(screen.getByText("fresh.log")).toBeInTheDocument());
  });

  it("hides internal grouped node path keys in current-path labels", () => {
    render(
      <FilesBrowserSpa
        initialData={{
          ...baseData,
          nodeIdFilter: "",
          currentPath: "存储__cmps1rmy/docs",
          nodes: [
            { id: "cmps1rmyabcdef", name: "45.88.1.2", driver: "SFTP" },
          ],
        }}
        deletedEntries={[]}
      />,
    );

    expect(screen.getAllByText(/当前路径：45\.88\.1\.2（SFTP）：\/docs/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/存储__cmps1rmy/)).not.toBeInTheDocument();
  });

  it("keeps nested directory tree collapsed until a folder is expanded", () => {
    render(
      <FilesBrowserSpa
        initialData={{ ...baseData, currentPath: "" }}
        deletedEntries={[]}
      />,
    );

    expect(screen.getByRole("button", { name: "photos" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "raw" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开 photos" }));

    expect(screen.getByRole("button", { name: "raw" })).toBeInTheDocument();
  });
});
