import React from "react";
import {
  fireEvent,
  screen,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FilesBrowserSpa } from "../files-browser-spa";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";

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

  it("shows a visible label for the file search input", () => {
    renderWithI18n(
      <FilesBrowserSpa
        initialData={baseData}
        deletedEntries={[]}
      />,
    );

    expect(screen.getByText("搜索文件名")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "搜索文件名" })).toHaveAttribute(
      "placeholder",
      "在当前目录搜索…",
    );
  });

  it("refreshes the SPA file list after upload completes", async () => {
    renderWithI18n(
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

    renderWithI18n(
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
    renderWithI18n(
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
    renderWithI18n(
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

  it("shows visible labels when filtering storage nodes before switching the file browser node", async () => {
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
    renderWithI18n(
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

    expect(screen.getAllByText("搜索存储节点")[0]!).toBeVisible();
    const sidebarSearch = screen.getAllByRole("searchbox", { name: "搜索存储节点" })[0]!;
    expect(sidebarSearch).toHaveAttribute("placeholder", "节点名称、类型或 ID");
    const sidebarSelect = screen.getAllByLabelText("选择存储节点")[0]!;
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

    renderWithI18n(
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
    fireEvent.change(screen.getAllByLabelText("选择存储节点")[0]!, {
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

    renderWithI18n(
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

  it("adds directory clicks to browser history and restores prior folders on back navigation", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...baseData,
          currentPath: "photos/raw",
          files: [
            {
              ...baseData.files[0],
              id: "file_raw",
              name: "raw.nef",
              relativePath: "photos/raw/raw.nef",
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...baseData,
          currentPath: "photos",
          files: [baseData.files[0]],
        }),
      } as Response);
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    renderWithI18n(
      <FilesBrowserSpa
        initialData={baseData}
        deletedEntries={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "raw" }));

    await waitFor(() => expect(screen.getByText("raw.nef")).toBeInTheDocument());
    expect(pushStateSpy).toHaveBeenCalledWith(null, "", "/files?path=photos%2Fraw&nodeId=node_1");

    await act(async () => {
      window.history.pushState(null, "", "/files?path=photos&nodeId=node_1");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/files/list?path=photos&nodeId=node_1",
        expect.any(Object),
      ),
    );
    await waitFor(() => expect(screen.getByText("before.jpg")).toBeInTheDocument());
    expect(replaceStateSpy).not.toHaveBeenCalledWith(null, "", "/files?path=photos&nodeId=node_1");

    pushStateSpy.mockRestore();
    replaceStateSpy.mockRestore();
  });

  it("hides internal grouped node path keys in current-path labels", () => {
    renderWithI18n(
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

    expect(screen.getAllByText(/当前路径：45\.88\.1\.2 \(SFTP\): \/docs/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/存储__cmps1rmy/)).not.toBeInTheDocument();
  });

  it("keeps nested directory tree collapsed until a folder is expanded", () => {
    renderWithI18n(
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

  it("collapses the directory tree sidebar behind a mobile toggle button by default", () => {
    renderWithI18n(
      <FilesBrowserSpa
        initialData={baseData}
        deletedEntries={[]}
      />,
    );

    const toggle = screen.getByRole("button", { name: "展开目录树" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "files-browser-sidebar");
    expect(toggle.className).toMatch(/min-h-11/);
    expect(toggle.className).toMatch(/xl:hidden/);

    const sidebar = document.getElementById("files-browser-sidebar");
    expect(sidebar).not.toBeNull();
    expect(sidebar?.className.split(/\s+/)).toContain("hidden");
    expect(sidebar?.className.split(/\s+/)).toContain("xl:block");
  });

  it("expands the directory tree sidebar when the mobile toggle is clicked", () => {
    renderWithI18n(
      <FilesBrowserSpa
        initialData={baseData}
        deletedEntries={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "展开目录树" }));

    expect(
      screen.getByRole("button", { name: "收起目录树" }),
    ).toHaveAttribute("aria-expanded", "true");
    const sidebar = document.getElementById("files-browser-sidebar");
    expect(sidebar?.className.split(/\s+/)).not.toContain("hidden");
  });

  it("collapses the directory tree sidebar when the mobile toggle is clicked again", () => {
    renderWithI18n(
      <FilesBrowserSpa
        initialData={baseData}
        deletedEntries={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "展开目录树" }));
    fireEvent.click(screen.getByRole("button", { name: "收起目录树" }));

    expect(
      screen.getByRole("button", { name: "展开目录树" }),
    ).toHaveAttribute("aria-expanded", "false");
    const sidebar = document.getElementById("files-browser-sidebar");
    expect(sidebar?.className.split(/\s+/)).toContain("hidden");
  });

  it("auto-closes the directory tree sidebar on mobile after a tree navigation click", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...baseData,
        currentPath: "photos",
      }),
    } as Response);

    renderWithI18n(
      <FilesBrowserSpa
        initialData={{ ...baseData, currentPath: "" }}
        deletedEntries={[]}
      />,
    );

    // Open the sidebar
    fireEvent.click(screen.getByRole("button", { name: "展开目录树" }));
    expect(
      screen.getByRole("button", { name: "收起目录树" }),
    ).toHaveAttribute("aria-expanded", "true");

    // Click "photos" navigation button in the tree
    fireEvent.click(screen.getByRole("button", { name: "photos" }));

    // Sidebar should auto-close after navigation
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "展开目录树" }),
      ).toHaveAttribute("aria-expanded", "false"),
    );
    const sidebar = document.getElementById("files-browser-sidebar");
    expect(sidebar?.className.split(/\s+/)).toContain("hidden");

    // Verify the underlying navigation fetch was triggered
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/files/list?path=photos&nodeId=node_1",
        expect.any(Object),
      ),
    );
  });
});
