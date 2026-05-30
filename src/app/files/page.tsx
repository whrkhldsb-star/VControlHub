import Link from "next/link";

import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getStorageOverview } from "@/lib/storage/service";
import {
  buildFileTree,
  findFileTreeNode,
  isDirectoryEntry,
  normalizeFilePath,
  searchFileTree,
  serializeFileTreeFolder,
  serializeFileTreeNode,
} from "@/lib/files/tree";

import { getStorageFormOptions } from "@/app/storage/actions";
import { FilesBrowserSpa } from "./files-browser-spa";
import { PageShell } from "@/components/page-shell";
import { StorageNodeManager } from "./storage-node-manager";
import { SftpBrowser } from "./sftp-browser";

export const dynamic = "force-dynamic";

type FilesPageProps = {
  searchParams?: Promise<{
    path?: string;
    q?: string;
    tab?: string;
    scope?: string;
    nodeId?: string;
  }>;
};

export default async function FilesPage({ searchParams }: FilesPageProps) {
  const session = await requireSession("/files");
  const canEditLocalFiles = sessionHasPermission(session, "storage:write");
  const canDelete = sessionHasPermission(session, "storage:delete");
  const canManageNodes = sessionHasPermission(session, "storage:manage-node");
  const resolvedSearchParams = (await searchParams) ?? {};
  const currentPath = normalizeFilePath(resolvedSearchParams.path);
  const searchQuery = (resolvedSearchParams.q ?? "").trim();
  const searchScope = resolvedSearchParams.scope === "all" ? "all" : "current";
  const nodeIdFilter = resolvedSearchParams.nodeId ?? "";

  const [storage, formOptions] = await Promise.all([
    getStorageOverview(),
    canManageNodes || canEditLocalFiles
      ? getStorageFormOptions()
      : Promise.resolve({ servers: [], nodes: [] }),
  ]);

  // Filter entries by nodeId if specified
  const filteredEntries = nodeIdFilter
    ? storage.entries.filter((e) => e.storageNode.id === nodeIdFilter)
    : storage.entries;
  const virtualNodeDirectories = storage.nodes.map((node) => ({
    path: `${node.name}__${node.id.slice(0, 8)}`,
    name: node.name,
    storageNodeId: node.id,
    storageNodeName: node.name,
    storageNodeDriver: node.driver,
    fileCount: 0,
    itemCount: 0,
    totalSize: BigInt(0),
  }));
  const filteredDirectories = nodeIdFilter
    ? storage.remoteDirectories.filter((d) => d.storageNodeId === nodeIdFilter)
    : [...virtualNodeDirectories, ...storage.remoteDirectories];

  // When no specific node is selected, group entries by node to avoid
  // mixing SFTP root directories with LOCAL directories at root level
  const groupByNode = !nodeIdFilter;
  const tree = buildFileTree(filteredEntries, filteredDirectories, groupByNode);
  const currentNode = findFileTreeNode(tree, currentPath) ?? tree;
  let folders = [...currentNode.folders.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "zh-CN"),
  );
  let files = [...currentNode.files]
    .filter((entry) => !isDirectoryEntry(entry))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

  if (searchQuery) {
    const lowerQuery = searchQuery.toLowerCase();
    if (searchScope === "all") {
      const allResults = searchFileTree(tree, searchQuery);
      folders = allResults.folders;
      files = allResults.files;
    } else {
      folders = folders.filter((f) =>
        f.name.toLowerCase().includes(lowerQuery),
      );
      files = files.filter((e) => e.name.toLowerCase().includes(lowerQuery));
    }
  }

  const totalItems = folders.length + files.length;
  const sourceSummary = [...currentNode.sources.values()];

  // Build initial data for SPA component (same format as API response)
  const initialData = {
    currentPath,
    nodeIdFilter,
    folders: folders.map(serializeFileTreeFolder),
    files: files.map((entry) => ({
      id: entry.id,
      name: entry.name,
      entryType: entry.entryType,
      mimeType: entry.mimeType ?? null,
      relativePath: entry.relativePath,
      sizeLabel: entry.sizeLabel,
      previewable: entry.previewable,
      directAccessMode: entry.directAccess.mode,
      directAccessHref: entry.directAccess.href ?? null,
      directAccessDescription: entry.directAccess.description,
      storageNodeId: entry.storageNode.id,
      storageNodeName: entry.storageNode.name,
      storageNodeDriver: entry.storageNode.driver,
      updatedAt:
        "updatedAt" in entry && entry.updatedAt
          ? String(entry.updatedAt)
          : null,
    })),
    tree: {
      name: tree.name,
      path: tree.path,
      children: serializeFileTreeNode(tree),
    },
    stats: {
      ...storage.stats,
      totalItems,
    },
    sourceSummary,
    searchQuery,
    searchScope: searchScope as "current" | "all",
    permissions: {
      canEditLocalFiles,
      canDelete,
      canManageNodes,
    },
    nodes: storage.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      driver: n.driver,
    })),
  };

  const sftpNodes = storage.nodes.filter((n) => n.driver === "SFTP");

  return (
    <PageShell maxW="max-w-7xl">
      <header className="mb-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              文件与存储管理
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              文件浏览、上传下载、存储节点管理一体化
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-400">
            <Link
              href="/audit"
              className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 transition hover:bg-white/[0.06]"
            >
              审计日志
            </Link>
            <Link
              href="/health"
              className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 transition hover:bg-white/[0.06]"
            >
              系统自检
            </Link>
            <Link
              href="/servers"
              className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 transition hover:bg-white/[0.06]"
            >
              服务器管理
            </Link>
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-4 mb-8">
        <article className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 hover:bg-white/[0.05] transition-colors duration-150">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            文件节点
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-white">
            {storage.stats.totalNodes}
          </div>
        </article>
        <article className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 hover:bg-white/[0.05] transition-colors duration-150">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            活跃文件
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-white">
            {storage.stats.totalEntries}
          </div>
        </article>
        <article className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 hover:bg-white/[0.05] transition-colors duration-150">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            当前目录
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-white">
            {totalItems}
          </div>
        </article>
        <article className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 hover:bg-white/[0.05] transition-colors duration-150">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            回收站
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-white">
            {storage.stats.deletedEntries}
          </div>
        </article>
      </section>

      <section className="mb-8 grid gap-3 lg:grid-cols-3">
        <Link
          href="/files?scope=all"
          className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] p-4 transition hover:bg-cyan-400/[0.1]"
        >
          <div className="text-sm font-semibold text-white">全局文件搜索</div>
          <p className="mt-1.5 text-sm leading-6 text-slate-300">
            跨本地和 SFTP 节点搜索文件名，适合快速定位配置、日志和上传文件。
          </p>
          <div className="mt-3 text-xs text-cyan-200">打开全局搜索</div>
        </Link>
        <Link
          href="/files?scope=current"
          className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 transition hover:bg-white/[0.06]"
        >
          <div className="text-sm font-semibold text-white">当前目录检索</div>
          <p className="mt-1.5 text-sm leading-6 text-slate-300">
            在当前路径内筛选文件名，适合编辑前先缩小范围。
          </p>
          <div className="mt-3 text-xs text-slate-400">仅当前目录</div>
        </Link>
        <Link
          href="/files?tab=recycle"
          className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 transition hover:bg-white/[0.06]"
        >
          <div className="text-sm font-semibold text-white">回收站</div>
          <p className="mt-1.5 text-sm leading-6 text-slate-300">
            查看最近删除的文件，做误删恢复前的快速核对。
          </p>
          <div className="mt-3 text-xs text-slate-400">进入回收站</div>
        </Link>
      </section>

      <StorageNodeManager
        nodes={storage.nodes}
        servers={formOptions.servers}
        canManageNodes={canManageNodes}
      />

      <SftpBrowser
        sftpNodes={sftpNodes.map((n) => ({
          id: n.id,
          name: n.name,
          driver: n.driver,
          serverId: n.serverId ?? null,
          serverName: n.server?.name ?? null,
        }))}
      />

      <FilesBrowserSpa
        initialData={initialData}
        deletedEntries={storage.deletedEntries.map((d) => ({
          id: d.id,
          name: d.name,
          entryType: d.entryType,
          relativePath: d.relativePath,
          size: d.size,
        }))}
      />
    </PageShell>
  );
}
