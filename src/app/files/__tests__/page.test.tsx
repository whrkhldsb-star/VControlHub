import React from "react";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const baseStorageOverview = {
  nodes: [
    {
      id: "node_1",
      name: "主控本机",
      driver: "LOCAL",
      isDefault: true,
      connectionSummary: "本机存储：/srv/whrkhldsb/storage",
      directAccess: {
        mode: "managed-download" as const,
        description: "本机文件由管理端直接提供受控下载与预览。",
      },
      fileCount: 2,
    },
    {
      id: "node_2",
      name: "香港媒体库",
      driver: "SFTP",
      isDefault: false,
      connectionSummary: "SFTP 存储：203.0.113.11:22",
      directAccess: {
        mode: "managed-download" as const,
        description:
          "远端文件经管理端 SFTP 代理中转下载（来自 203.0.113.11:22）。",
        href: "/api/storage/sftp-download?nodeId=node_2&path=",
      },
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
      directAccess: {
        mode: "managed-download" as const,
        description: "本机文件由管理端直接提供受控下载与预览。",
      },
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
      directAccess: {
        mode: "managed-download" as const,
        description:
          "远端文件经管理端 SFTP 代理中转下载（来自 203.0.113.11:22）。",
        href: "/api/storage/sftp-download?nodeId=node_2&path=",
      },
      storageNode: { id: "node_2", name: "香港媒体库", driver: "SFTP" },
      entryType: "FILE" as const,
    },
  ],
  deletedEntries: [] as Array<{ id: string }>,
  remoteDirectories: [
    {
      storageNodeId: "node_2",
      storageNodeName: "香港媒体库",
      storageNodeDriver: "SFTP",
      path: "media",
      name: "media",
      itemCount: 1,
    },
    {
      storageNodeId: "node_2",
      storageNodeName: "香港媒体库",
      storageNodeDriver: "SFTP",
      path: "media/videos",
      name: "videos",
      itemCount: 1,
    },
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
  getStorageAccessCapabilitiesMock,
  getSftpSyncNodeMock,
  syncSftpDirectoryEntriesMock,
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
  getStorageAccessCapabilitiesMock: vi.fn(),
  getSftpSyncNodeMock: vi.fn(),
  syncSftpDirectoryEntriesMock: vi.fn(),
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

vi.mock("@/lib/storage/access-control", () => ({
  getStorageAccessCapabilities: getStorageAccessCapabilitiesMock,
  getStorageAccessCapabilityKey: ({ storageNodeId, relativePath }: { storageNodeId: string; relativePath?: string | null }) =>
    `${storageNodeId}:${relativePath ?? ""}`,
}));

vi.mock("@/lib/storage/sftp-sync", () => ({
  getSftpSyncNode: getSftpSyncNodeMock,
  syncSftpDirectoryEntries: syncSftpDirectoryEntriesMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
    push: pushMock,
    replace: replaceMock,
    prefetch: prefetchMock,
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined),
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
  CreateFolderForm: ({
    storageNodes,
    currentPath,
  }: {
    storageNodes: { id: string; name: string; driver: string }[];
    currentPath: string;
  }) => {
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
  DeleteConfirmButton: (props: {
    fileEntryId: string;
    entryName: string;
    entryType: string;
  }) => {
    return React.createElement(
      "button",
      {
        type: "button",
        "data-testid": "delete-btn",
        "data-file-entry-id": props.fileEntryId,
        "data-entry-name": props.entryName,
      },
      "\u5220\u9664 " + props.entryName,
    );
  },
}));

vi.mock("./rename-inline-form", () => ({
  RenameInlineForm: (props: {
    fileEntryId: string;
    currentName: string;
    currentPath: string;
    entryType: string;
  }) => {
    return React.createElement(
      "button",
      {
        type: "button",
        "data-testid": "rename-btn",
        "data-file-entry-id": props.fileEntryId,
        "data-current-name": props.currentName,
      },
      "\u91CD\u547D\u540D " + props.currentName,
    );
  },
}));

vi.mock("./move-inline-form", () => ({
  MoveInlineForm: (props: {
    fileEntryId: string;
    name: string;
    relativePath: string;
    storageNodeId: string;
    storageNodeName: string;
  }) => {
    return React.createElement(
      "button",
      {
        type: "button",
        "data-testid": "move-btn",
        "data-file-entry-id": props.fileEntryId,
        "data-name": props.name,
      },
      "\u79FB\u52A8 " + props.name,
    );
  },
}));

vi.mock("./restore-button", () => ({
  RestoreButton: (props: { fileEntryId: string }) => {
    return React.createElement(
      "button",
      {
        type: "submit",
        "data-testid": "restore-btn",
        "data-file-entry-id": props.fileEntryId,
      },
      "\u6062\u590D",
    );
  },
}));

vi.mock("./permanent-delete-button", () => ({
  PermanentDeleteButton: (props: {
    fileEntryId: string;
    entryName: string;
  }) => {
    return React.createElement(
      "button",
      {
        type: "button",
        "data-testid": "permanent-delete-btn",
        "data-file-entry-id": props.fileEntryId,
        "data-entry-name": props.entryName,
      },
      "\u6C38\u4E45\u5220\u9664 " + props.entryName,
    );
  },
}));

import FilesPage from "../page";

beforeEach(() => {
  getStorageOverviewMock.mockResolvedValue(
    structuredClone(baseStorageOverview),
  );
  listStorageNodesMock.mockResolvedValue(
    structuredClone(baseStorageOverview.nodes),
  );
  getStorageAccessCapabilitiesMock.mockResolvedValue(new Map());
  getSftpSyncNodeMock.mockResolvedValue(null);
  syncSftpDirectoryEntriesMock.mockResolvedValue({
    synced: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    errors: [],
  });
});

describe("FilesPage", () => {
  it("renders directory browsing and downloads in a cloud-drive style layout", async () => {
    render(
      await FilesPage({
        searchParams: Promise.resolve({ path: "docs", nodeId: "node_1" }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "文件与存储管理" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "全部文件" }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "docs" })).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "下载 notes.txt" })[0],
    ).toHaveAttribute(
      "href",
      "/api/storage/local?path=docs%2Fnotes.txt&nodeId=node_1&download=1",
    );
    expect(
      await screen.findByRole("heading", { name: /回收站/ }),
    ).toBeInTheDocument();
  });

  it("shows a drive-style toolbar with search, upload, and folder creation", async () => {
    render(
      await FilesPage({
        searchParams: Promise.resolve({ path: "docs", nodeId: "node_1" }),
      }),
    );

    expect(
      screen.getByRole("heading", { name: "当前目录操作" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "⬆ 上传文件" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "新建文件夹" }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole("textbox", { name: "搜索文件名" }),
    ).toHaveAttribute("placeholder", "在当前目录搜索…");
    expect(screen.getAllByText(/主控本机/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "⬆ 上传文件" })).toHaveAttribute(
      "href",
      "#upload-section",
    );
  });

  it("renders per-entry actions from storage access capabilities on the initial page payload", async () => {
    getStorageAccessCapabilitiesMock.mockResolvedValueOnce(
      new Map([
        ["node_1:docs", { canRead: true, canWrite: true, canDelete: true }],
        ["node_1:docs/notes.txt", { canRead: true, canWrite: true, canDelete: true }],
        ["node_2:media/videos/demo.mp4", { canRead: true, canWrite: true, canDelete: true }],
      ]),
    );

    render(
      await FilesPage({
        searchParams: Promise.resolve({ path: "docs", nodeId: "node_1" }),
      }),
    );

    expect(getStorageAccessCapabilitiesMock).toHaveBeenCalledWith({
      session: expect.objectContaining({ userId: "u_1" }),
      targets: expect.arrayContaining([
        { storageNodeId: "node_1", relativePath: "docs/notes.txt" },
      ]),
    });
  });

  it("syncs the selected SFTP node before rendering the unified file list", async () => {
    const initialOverview = structuredClone(baseStorageOverview);
    const syncedOverview = structuredClone(baseStorageOverview);
    syncedOverview.entries = [
      {
        id: "file_synced",
        name: "live.log",
        mimeType: "text/plain",
        relativePath: "logs/live.log",
        sizeLabel: "2.0 KB",
        previewable: true,
        localEditable: false,
        directAccess: {
          mode: "managed-download" as const,
          description: "远端文件经管理端 SFTP 代理中转下载。",
          href: "/api/storage/sftp-download?nodeId=node_2&path=",
        },
        storageNode: { id: "node_2", name: "香港媒体库", driver: "SFTP" },
        entryType: "FILE" as const,
      },
    ];
    getStorageOverviewMock
      .mockResolvedValueOnce(initialOverview)
      .mockResolvedValueOnce(syncedOverview);
    getSftpSyncNodeMock.mockResolvedValueOnce({ id: "node_2", driver: "SFTP" });

    render(
      await FilesPage({
        searchParams: Promise.resolve({ path: "logs", nodeId: "node_2" }),
      }),
    );

    expect(syncSftpDirectoryEntriesMock).toHaveBeenCalledWith({
      node: { id: "node_2", driver: "SFTP" },
      remotePath: "logs",
      recursive: false,
      maxDepth: 1,
    });
    expect(screen.queryByText("SFTP 远端浏览")).not.toBeInTheDocument();
    expect(screen.getAllByText("live.log").length).toBeGreaterThan(0);
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
          directAccess: {
            mode: "managed-download" as const,
            description:
              "远端文件经管理端 SFTP 代理中转下载（来自 203.0.113.11:22）。",
            href: "/api/storage/sftp-download?nodeId=node_2&path=",
          },
          storageNode: { id: "node_2", name: "香港媒体库", driver: "SFTP" },
          entryType: "FILE" as const,
        },
      ],
      remoteDirectories: [
        {
          storageNodeId: "node_2",
          storageNodeName: "香港媒体库",
          storageNodeDriver: "SFTP",
          path: "archives",
          name: "archives",
          itemCount: 1,
        },
        {
          storageNodeId: "node_2",
          storageNodeName: "香港媒体库",
          storageNodeDriver: "SFTP",
          path: "archives/releases",
          name: "releases",
          itemCount: 1,
        },
      ],
      stats: {
        ...baseStorageOverview.stats,
        totalEntries: 1,
        previewableEntries: 0,
        remoteDirectoryCount: 2,
      },
    });

    render(
      await FilesPage({ searchParams: Promise.resolve({ path: "archives" }) }),
    );

    expect(
      screen.getByRole("button", { name: "折叠 香港媒体库 (SFTP)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "打开 releases" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/当前路径：全部节点: \/archives/)[0]).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "打开" }).length,
    ).toBeGreaterThan(0);
  });

  it("does not render directory-shaped file entries in the file grid", async () => {
    getStorageOverviewMock.mockResolvedValue({
      ...structuredClone(baseStorageOverview),
      entries: [
        {
          id: "dir_bad",
          name: "archives",
          mimeType: "inode/directory",
          relativePath: "archives",
          sizeLabel: "-",
          previewable: false,
          localEditable: false,
          directAccess: {
            mode: "managed-download" as const,
            description:
              "远端文件经管理端 SFTP 代理中转下载（来自 203.0.113.11:22）。",
            href: "/api/storage/sftp-download?nodeId=node_2&path=",
          },
          storageNode: { id: "node_2", name: "香港媒体库", driver: "SFTP" },
          entryType: "FILE" as const,
        },
      ],
      remoteDirectories: [
        {
          storageNodeId: "node_2",
          storageNodeName: "香港媒体库",
          storageNodeDriver: "SFTP",
          path: "archives",
          name: "archives",
          itemCount: 1,
        },
      ],
      stats: {
        ...baseStorageOverview.stats,
        totalEntries: 1,
        previewableEntries: 0,
        remoteDirectoryCount: 1,
      },
    });

    render(await FilesPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByRole("button", { name: "展开 香港媒体库 (SFTP)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "打开 archives" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("-")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /archives/ }),
    ).not.toBeInTheDocument();
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
          directAccess: {
            mode: "managed-download" as const,
            description:
              "远端文件经管理端 SFTP 代理中转下载（来自 203.0.113.11:22）。",
            href: "/api/storage/sftp-download?nodeId=node_2&path=",
          },
          storageNode: { id: "node_2", name: "香港媒体库", driver: "SFTP" },
          entryType: "DIRECTORY" as const,
        },
      ],
      remoteDirectories: [
        {
          storageNodeId: "node_2",
          storageNodeName: "香港媒体库",
          storageNodeDriver: "SFTP",
          path: "archives",
          name: "archives",
          itemCount: 1,
        },
        {
          storageNodeId: "node_2",
          storageNodeName: "香港媒体库",
          storageNodeDriver: "SFTP",
          path: "archives/releases",
          name: "releases",
          itemCount: 1,
        },
      ],
      stats: {
        ...baseStorageOverview.stats,
        totalEntries: 1,
        previewableEntries: 0,
        remoteDirectoryCount: 2,
      },
    });

    render(
      await FilesPage({ searchParams: Promise.resolve({ path: "archives" }) }),
    );

    expect(screen.getAllByText(/香港媒体库/).length).toBeGreaterThan(0);
    expect(screen.getByText(/项目数 2/)).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "打开" }).length,
    ).toBeGreaterThan(0);
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

    expect(
      await screen.findByRole("heading", { name: /回收站/ }),
    ).toBeInTheDocument();
    const restoreBtns = screen.queryAllByTestId("restore-btn");
    const permanentDeleteBtns = screen.queryAllByTestId("permanent-delete-btn");
    if (restoreBtns.length === 0) {
      const allButtons = screen.getAllByRole("button");
      expect(
        allButtons.some((btn: HTMLElement) =>
          btn.textContent?.includes("恢复"),
        ),
      ).toBe(true);
      expect(
        allButtons.some((btn: HTMLElement) =>
          btn.textContent?.includes("永久删除"),
        ),
      ).toBe(true);
    } else {
      expect(
        restoreBtns.some(
          (btn: HTMLElement) =>
            btn.getAttribute("data-file-entry-id") === "del_1",
        ),
      ).toBe(true);
      expect(
        permanentDeleteBtns.some(
          (btn: HTMLElement) =>
            btn.getAttribute("data-entry-name") === "old-file.txt",
        ),
      ).toBe(true);
    }
  });
});
