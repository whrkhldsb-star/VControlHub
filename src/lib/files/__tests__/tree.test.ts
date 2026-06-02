import { describe, expect, it } from "vitest";

import {
  buildFileTree,
  findFileTreeNode,
  getStorageNodeGroupKey,
  normalizeFilePath,
  resolveStorageNodeGroupedPath,
  searchFileTree,
  serializeFileTreeFolder,
  serializeFileTreeNode,
  type StorageDirectoryForTree,
  type StorageEntryForTree,
} from "../tree";

function entry(overrides: Partial<StorageEntryForTree> & { id: string; relativePath: string; nodeId?: string; nodeName?: string; driver?: string }): StorageEntryForTree {
  const nodeId = overrides.nodeId ?? "node_1";
  const nodeName = overrides.nodeName ?? "主节点";
  const driver = overrides.driver ?? "LOCAL";
  return {
    id: overrides.id,
    name: overrides.relativePath.split("/").pop() ?? overrides.relativePath,
    relativePath: overrides.relativePath,
    entryType: overrides.entryType ?? "FILE",
    mimeType: overrides.mimeType ?? "text/plain",
    size: overrides.size ?? 10,
    sizeLabel: overrides.sizeLabel ?? "10 B",
    previewable: overrides.previewable ?? true,
    directAccess: overrides.directAccess ?? { mode: "download", href: null, description: "下载" },
    storageNode: overrides.storageNode ?? { id: nodeId, name: nodeName, driver, serverId: null, server: null },
    updatedAt: overrides.updatedAt ?? null,
  } as StorageEntryForTree;
}

function directory(overrides: Partial<StorageDirectoryForTree> & { path: string; nodeId?: string; nodeName?: string; driver?: string }): StorageDirectoryForTree {
  const nodeId = overrides.nodeId ?? "node_1";
  return {
    path: overrides.path,
    storageNodeId: nodeId,
    storageNodeName: overrides.nodeName ?? "主节点",
    storageNodeDriver: overrides.driver ?? "LOCAL",
  } as StorageDirectoryForTree;
}

describe("file tree helpers", () => {
  it("normalizes slashes, whitespace and empty segments", () => {
    expect(normalizeFilePath("  /var//log/../app  ")).toBe("var/log/../app");
    expect(normalizeFilePath("\\tmp\\ uploads ")).toBe("tmp/uploads");
    expect(normalizeFilePath(null)).toBe("");
  });

  it("resolves internal grouped paths back to their storage node and remote path", () => {
    const nodes = [
      { id: "cmps1rmyz00018qv26pty0w74", name: "45.207.216.45 存储", driver: "SFTP" },
      { id: "node_local_default", name: "本机默认存储", driver: "LOCAL" },
    ];
    const groupKey = getStorageNodeGroupKey(nodes[0]);

    expect(groupKey).toBe("45.207.216.45 存储__cmps1rmy");
    expect(resolveStorageNodeGroupedPath(`${groupKey}/probe/new-folder`, nodes)).toEqual({
      node: nodes[0],
      groupPath: groupKey,
      remotePath: "probe/new-folder",
    });
  });

  it("groups multiple storage nodes at the root without mixing their folders", () => {
    const tree = buildFileTree(
      [
        entry({ id: "local_file", relativePath: "shared/a.txt", nodeId: "local_1", nodeName: "本地", driver: "LOCAL" }),
        entry({ id: "sftp_file", relativePath: "shared/b.txt", nodeId: "sftp_1", nodeName: "远端", driver: "SFTP" }),
      ],
      [
        directory({ path: "shared", nodeId: "local_1", nodeName: "本地", driver: "LOCAL" }),
        directory({ path: "shared", nodeId: "sftp_1", nodeName: "远端", driver: "SFTP" }),
      ],
      true,
    );

    const rootFolders = [...tree.folders.values()].map((folder) => serializeFileTreeFolder(folder));
    expect(rootFolders).toHaveLength(2);
    expect(rootFolders.map((folder) => folder.displayName).sort()).toEqual(["本地（LOCAL）", "远端（SFTP）"]);
    expect(rootFolders.every((folder) => folder.path.includes("__"))).toBe(true);
  });

  it("groups configured storage nodes even when a node only has nested media files", () => {
    const tree = buildFileTree(
      [
        entry({
          id: "video_file",
          relativePath: "movies/2026/demo.mp4",
          nodeId: "sftp_1",
          nodeName: "远端",
          driver: "SFTP",
          mimeType: "application/octet-stream",
        }),
      ],
      [],
      true,
      [
        { id: "local_1", name: "本地", driver: "LOCAL" },
        { id: "sftp_1", name: "远端", driver: "SFTP" },
      ],
    );

    const rootFolders = serializeFileTreeNode(tree);
    expect(rootFolders.map((folder) => folder.displayName).sort()).toEqual([
      "本地（LOCAL）",
      "远端（SFTP）",
    ]);
    const remote = rootFolders.find((folder) => folder.displayName === "远端（SFTP）");
    expect(remote?.fileCount).toBe(1);
    expect(remote?.folderCount).toBe(1);
    const movies = remote?.children.find((folder) => folder.name === "movies");
    expect(movies?.fileCount).toBe(1);
  });

  it("finds, serializes and searches folders/files consistently", () => {
    const tree = buildFileTree(
      [
        entry({ id: "readme", relativePath: "docs/README.md" }),
        entry({ id: "config", relativePath: "config/app.json" }),
      ],
      [directory({ path: "docs" }), directory({ path: "config" })],
      false,
    );

    const docs = findFileTreeNode(tree, "docs");
    expect(docs?.path).toBe("docs");
    expect(docs?.files.map((file) => file.name)).toEqual(["README.md"]);

    const serialized = serializeFileTreeNode(tree);
    expect(serialized.map((node) => node.name).sort()).toEqual(["config", "docs"]);

    const searchResult = searchFileTree(tree, "readme");
    expect(searchResult.files.map((file) => file.id)).toEqual(["readme"]);
    expect(searchResult.folders).toEqual([]);
  });
});
