"use client";

import { useState, useCallback, useRef } from "react";
import { logError } from "@/lib/logging";
import { csrfFetch } from "@/lib/auth/csrf-client";

import { FileListClient, type FolderProp, type FileProp } from "./file-list-client";
import { SearchScopeToggle } from "./search-scope-toggle";
import { FileUploadDropzone } from "@/components/storage/file-upload-dropzone";
import { CreateFolderForm } from "./create-folder-form";
import { RecycleBinSectionClient } from "./recycle-bin-section-client";

/* ── Types ──────────────────────────────────────────────────────── */

type TreeNode = {
	name: string;
	displayName?: string;
	path: string;
	entryId?: string | null;
	fileCount: number;
	folderCount: number;
	sourceKeys: string[];
	sourceValues: string[];
	children: TreeNode[] | null;
};

type TreeRootNode = {
	name: string;
	path: string;
	fileCount?: number;
	folderCount?: number;
	sourceKeys?: string[];
	sourceValues?: string[];
	children: TreeNode[] | null;
};

type FilesApiResponse = {
	currentPath: string;
	nodeIdFilter: string;
	folders: FolderProp[];
	files: FileProp[];
	tree: TreeRootNode;
	stats: {
		totalNodes: number;
		defaultNodeName: string;
		localNodeCount: number;
		sftpNodeCount: number;
		totalEntries: number;
		previewableEntries: number;
		deletedEntries: number;
		remoteDirectoryCount: number;
		totalItems: number;
	};
	sourceSummary: string[];
	searchQuery: string;
	searchScope: "current" | "all";
	syncWarning?: string | null;
	permissions: {
		canEditLocalFiles: boolean;
		canDelete: boolean;
		canManageNodes: boolean;
	};
	nodes: { id: string; name: string; driver: string }[];
};

type DeletedEntryProp = {
	id: string;
	name: string;
	entryType: string;
	relativePath: string;
	size: number | bigint | null;
};

/* ── Helpers ────────────────────────────────────────────────────── */

function splitPath(path: string) {
	return path ? path.split("/").filter(Boolean) : [];
}

function getFolderLabel(path: string) {
	const segments = splitPath(path);
	if (segments.length === 0) return "全部文件";
	const lastSegment = segments[segments.length - 1];
	// If last segment is a node group key (name__id), extract just the name part
	if (lastSegment.includes("__")) {
		return lastSegment.split("__")[0];
	}
	return lastSegment;
}

function getCurrentPathLabel(path: string) {
	if (!path) return "/";
	const segments = splitPath(path);
	return "/" + segments.map((s) => (s.includes("__") ? s.split("__")[0] : s)).join("/");
}

/* ── Navigation hook ────────────────────────────────────────────── */

function useFolderNavigation(fetchFiles: (path: string, q?: string, scope?: string) => void) {
	const navigateToFolder = useCallback(
		(path: string) => {
			fetchFiles(path);
		},
		[fetchFiles],
	);

	return { navigateToFolder };
}

/* ── FolderTree (client-side, SPA) ──────────────────────────────── */

function FolderTreeClient({
	node,
	currentPath,
	onNavigate,
	depth = 0,
}: {
	node: TreeRootNode;
	currentPath: string;
	onNavigate: (path: string) => void;
	depth?: number;
}) {
	const children = node.children;
	if (!children || children.length === 0) return null;

	return (
		<ul className="mt-3 space-y-1 border-l border-white/10 pl-3">
			{children.map((child) => {
				const isCurrent = child.path === currentPath;
				return (
					<li key={child.path || child.name}>
						<button
							type="button"
							onClick={() => onNavigate(child.path)}
							aria-current={isCurrent ? "page" : undefined}
							aria-label={child.name}
							className={`flex w-full items-center justify-between rounded-2xl px-3 py-2 text-sm transition text-left ${
								isCurrent
									? "bg-cyan-400/10 text-cyan-100"
									: "text-slate-300 hover:bg-white/5 hover:text-white"
							}`}
						>
							<span className="truncate">📁 {child.displayName ?? child.name}</span>
							<span aria-hidden="true" className="ml-3 text-xs text-slate-500">
								{child.fileCount + child.folderCount}
							</span>
						</button>
						{child.children && child.children.length > 0 ? (
							<FolderTreeClient node={child} currentPath={currentPath} onNavigate={onNavigate} depth={depth + 1} />
						) : null}
					</li>
				);
			})}
		</ul>
	);
}

/* ── Breadcrumbs (client-side, SPA) ─────────────────────────────── */

function BreadcrumbsClient({
	path,
	onNavigate,
}: {
	path: string;
	onNavigate: (path: string) => void;
}) {
	const segments = splitPath(path);

	return (
		<nav aria-label="面包屑" className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
			<button
				type="button"
				onClick={() => onNavigate("")}
				className="rounded-full border border-white/10 px-3 py-1.5 text-slate-200 hover:bg-white/5"
			>
				全部文件
			</button>
			{segments.map((segment, index) => {
				const nextPath = segments.slice(0, index + 1).join("/");
				const isLast = index === segments.length - 1;
				// For node group keys (name__id), show just the name part
				const displaySegment = segment.includes("__") ? segment.split("__")[0] : segment;
				return (
					<span key={nextPath} className="flex items-center gap-2">
						<span>/</span>
						{isLast ? (
							<span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-cyan-100">
								{displaySegment}
							</span>
						) : (
							<button
								type="button"
								onClick={() => onNavigate(nextPath)}
								className="rounded-full border border-white/10 px-3 py-1.5 text-slate-200 hover:bg-white/5"
							>
								{displaySegment}
							</button>
						)}
					</span>
				);
			})}
		</nav>
	);
}

/* ── Main Component ─────────────────────────────────────────────── */

export function FilesBrowserSpa({
	initialData,
	deletedEntries,
}: {
	initialData: FilesApiResponse;
	deletedEntries: DeletedEntryProp[];
	sftpNodes?: { id: string; name: string; driver: string; serverId: string | null; serverName: string | null }[];
}) {
	const [data, setData] = useState<FilesApiResponse>(initialData);
	const [loading, setLoading] = useState(false);
	const [listError, setListError] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	// Fetch files for a given path — SPA navigation, no page reload
	const fetchFiles = useCallback(
		async (path: string, q?: string, scope?: string, nodeId?: string) => {
			// Cancel previous request
			if (abortRef.current) {
				abortRef.current.abort();
			}
			const controller = new AbortController();
			abortRef.current = controller;

			setLoading(true);
			setListError(null);
			try {
				const params = new URLSearchParams();
				if (path) params.set("path", path);
				if (q) params.set("q", q);
				if (scope && scope !== "current") params.set("scope", scope);
				const effectiveNodeId = nodeId ?? data.nodeIdFilter;
				if (effectiveNodeId) params.set("nodeId", effectiveNodeId);

				const url = `/api/files/list${params.toString() ? `?${params.toString()}` : ""}`;
				const json = await csrfFetch(url, { signal: controller.signal });
				const nextData = json as FilesApiResponse;
				setData(nextData);
				if (nextData.syncWarning) {
					setListError(nextData.syncWarning);
				}

				// Update URL without page reload
				const urlParams = new URLSearchParams();
				if (path) urlParams.set("path", path);
				if (q) urlParams.set("q", q);
				if (scope && scope !== "current") urlParams.set("scope", scope);
				if (effectiveNodeId) urlParams.set("nodeId", effectiveNodeId);
				const qs = urlParams.toString();
				const newUrl = qs ? `/files?${qs}` : "/files";
				window.history.replaceState(null, "", newUrl);
			} catch (err) {
				if (err instanceof Error && err.name === "AbortError") return;
				logError("Failed to fetch files:", err);
				setListError(err instanceof Error ? err.message : "文件列表刷新失败，请稍后重试。");
			} finally {
				setLoading(false);
			}
		},
		[data.nodeIdFilter],
	);

	const { navigateToFolder } = useFolderNavigation(fetchFiles);

	// Search handler
	const [searchInput, setSearchInput] = useState(data.searchQuery);
	const handleSearch = useCallback(
		(e: React.FormEvent) => {
			e.preventDefault();
			fetchFiles(data.currentPath, searchInput, data.searchScope, data.nodeIdFilter);
		},
		[fetchFiles, data.currentPath, searchInput, data.searchScope, data.nodeIdFilter],
	);

	const handleScopeChange = useCallback(
		(newScope: string) => {
			fetchFiles(data.currentPath, data.searchQuery, newScope, data.nodeIdFilter);
		},
		[fetchFiles, data.currentPath, data.searchQuery, data.nodeIdFilter],
	);

	const localNodes = data.nodes.filter((n) => n.driver === "LOCAL");
	const currentPathLabel = getCurrentPathLabel(data.currentPath);

	// Node filter handler
	const handleNodeFilterChange = useCallback(
		(e: React.ChangeEvent<HTMLSelectElement>) => {
			const newNodeId = e.target.value;
			// Reset to root path when switching nodes
			fetchFiles("", data.searchQuery, data.searchScope, newNodeId);
		},
		[fetchFiles, data.searchQuery, data.searchScope],
	);

	return (
		<section className="mt-8 grid gap-8 xl:grid-cols-[280px_minmax(0,1fr)]">
			{/* Sidebar: Directory tree */}
			<aside className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
				<div className="flex items-center justify-between gap-3">
					<div>
						<h2 className="text-2xl font-semibold text-white">目录树</h2>
						<p className="mt-2 text-sm leading-7 text-slate-300">
							按层级展开所有已登记目录，便于快速跳转。
						</p>
					</div>
				</div>

			{/* Node filter in sidebar - compact for sidebar */}
			{data.nodes.length > 1 ? (
				<div className="mt-4 flex flex-col gap-1.5">
					<label htmlFor="node-filter-select" className="text-xs text-slate-400">
						📂 按节点筛选
					</label>
					<select
						id="node-filter-select"
						value={data.nodeIdFilter}
						onChange={handleNodeFilterChange}
						className="rounded-2xl border border-cyan-400/30 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-400/50 focus:outline-none"
					>
						<option value="">🌐 全部节点</option>
						{data.nodes.map((n) => (
							<option key={n.id} value={n.id}>
								{n.driver === "SFTP" ? "🖥" : "💾"} {n.name}（{n.driver}）
							</option>
						))}
					</select>
				</div>
			) : null}

				<div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
					<button
						type="button"
						onClick={() => navigateToFolder("")}
						className={`flex w-full items-center justify-between rounded-2xl px-3 py-2 text-sm text-left ${
							data.currentPath === ""
								? "bg-cyan-400/10 text-cyan-100"
								: "text-cyan-100 hover:bg-white/5"
						}`}
					>
						<span>全部文件</span>
						<span className="text-xs text-cyan-200/70">{data.stats.totalEntries}</span>
					</button>
					{data.tree.children && data.tree.children.length > 0 ? (
						<FolderTreeClient node={data.tree} currentPath={data.currentPath} onNavigate={navigateToFolder} />
					) : null}
				</div>
			</aside>

			{/* Main content area */}
			<section className="space-y-8">
				{/* VPS Node Selector - prominent card */}
				{data.nodes.length > 1 ? (
					<article className="rounded-3xl border border-cyan-400/20 bg-gradient-to-r from-cyan-400/5 to-slate-900/60 p-5">
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div>
								<h3 className="text-lg font-semibold text-white">🖥 切换存储节点</h3>
								<p className="mt-1 text-sm text-slate-400">
									选择VPS节点查看对应文件，或浏览全部节点
								</p>
							</div>
							<div className="flex flex-wrap gap-2">
								<button
									type="button"
									onClick={() => fetchFiles("", data.searchQuery, data.searchScope, "")}
									className={`rounded-full px-4 py-2 text-sm font-medium transition ${
										data.nodeIdFilter === ""
											? "border border-cyan-400/50 bg-cyan-400/20 text-cyan-100"
											: "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
									}`}
								>
									🌐 全部节点
								</button>
								{data.nodes.map((n) => (
									<button
										key={n.id}
										type="button"
										onClick={() => fetchFiles("", data.searchQuery, data.searchScope, n.id)}
										className={`rounded-full px-4 py-2 text-sm font-medium transition ${
											data.nodeIdFilter === n.id
												? "border border-cyan-400/50 bg-cyan-400/20 text-cyan-100"
												: "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
										}`}
									>
										{n.driver === "SFTP" ? "🖥" : "💾"} {n.name}
									</button>
								))}
							</div>
						</div>
					</article>
				) : null}

				{/* Search + Toolbar */}
				<article className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
					<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
						<div>
							<h2 className="text-2xl font-semibold text-white">
								{getFolderLabel(data.currentPath)}
								{loading ? <span className="ml-2 text-sm text-cyan-300 animate-pulse">加载中…</span> : null}
							</h2>
							<p className="mt-2 text-sm leading-7 text-slate-300">
								{data.currentPath ? `当前路径：/${data.currentPath}` : "当前路径：根目录"}
							</p>
						</div>
						<BreadcrumbsClient path={data.currentPath} onNavigate={navigateToFolder} />
					</div>

					{/* Search bar */}
					<form onSubmit={handleSearch} className="mt-4">
						<input type="hidden" name="scope" value={data.searchScope} />
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
							<SearchScopeToggle
								scope={data.searchScope}
								currentPath={data.currentPath}
								onScopeChange={handleScopeChange}
							/>
							<div className="flex flex-1 gap-3">
								<input
									type="text"
									value={searchInput}
									onChange={(e) => setSearchInput(e.currentTarget.value)}
									placeholder={data.searchScope === "all" ? "搜索全部文件名…" : "搜索当前目录文件名…"}
									className="flex-1 rounded-2xl border border-white/10 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
								/>
								<button
									type="submit"
									className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-5 py-2.5 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20"
								>
									搜索
								</button>
								{data.searchQuery ? (
									<button
										type="button"
										onClick={() => {
											setSearchInput("");
											fetchFiles(data.currentPath);
										}}
										className="rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10"
									>
										清除
									</button>
								) : null}
							</div>
						</div>
						{data.searchQuery ? (
							<p className="mt-2 text-xs text-slate-400">
								搜索 &quot;{data.searchQuery}&quot; —{" "}
								{data.searchScope === "all" ? "在全部文件中" : "在当前目录"}找到 {data.stats.totalItems} 个结果
							</p>
						) : null}
					</form>

					<div className="mt-6 rounded-3xl border border-cyan-400/20 bg-cyan-400/5 p-5">
						<div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
							<div>
								<h3 className="text-xl font-semibold text-white">当前目录操作</h3>
								<p className="mt-2 text-sm text-slate-300">
									{data.currentPath ? `当前路径：/${data.currentPath}` : "当前路径：/"}
								</p>
								<p className="mt-1 text-sm text-slate-300">
									项目数 {data.stats.totalItems}
									{data.sourceSummary.length > 0 ? ` · 来源节点：${data.sourceSummary.join("、")}` : ""}
								</p>
							</div>
							<div className="flex flex-wrap gap-3">
								{data.permissions.canEditLocalFiles ? (
									<a
										href="#upload-section"
										className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20"
									>
										⬆ 上传文件
									</a>
								) : null}
								{data.permissions.canEditLocalFiles && data.nodes.length > 0 ? (
									<CreateFolderForm
										storageNodes={data.nodes}
										currentPath={data.currentPath}
									/>
								) : (
									<button
										type="button"
										disabled
										aria-disabled="true"
										className="cursor-not-allowed rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-400"
									>
										新建文件夹
									</button>
								)}
							</div>
						</div>
					</div>

					{/* File list with batch operations */}
					{listError ? (
						<div role="alert" className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100 light:text-amber-800">
							{data.syncWarning === listError ? "远端同步提醒" : "文件列表刷新失败"}：{listError}
						</div>
					) : null}
<FileListClient
 folders={data.folders}
 files={data.files}
 canEditLocalFiles={data.permissions.canEditLocalFiles}
 canDelete={data.permissions.canDelete}
 currentPath={data.currentPath}
 searchQuery={data.searchQuery}
 onFolderClick={navigateToFolder}
 onRefresh={() => fetchFiles(data.currentPath)}
 />
				</article>

				{/* Upload section */}
				{data.permissions.canEditLocalFiles ? (
					<div id="upload-section">
						<FileUploadDropzone
							nodes={data.nodes}
							initialNodeId={localNodes[0]?.id ?? data.nodes[0]?.id}
							initialRelativeDir={data.currentPath}
							uploadDir={data.currentPath}
							title={`上传到当前目录 ${currentPathLabel}`}
							description="选择目标存储节点和上传目录路径。"
							submitLabel="拖拽文件到这里，或点击选择本地文件"
							pathLabel="上传目录路径"
							allowNodeSelection={true}
							onUploadComplete={() => fetchFiles(data.currentPath, data.searchQuery, data.searchScope, data.nodeIdFilter)}
						/>
					</div>
				) : null}

				{/* Recycle bin */}
				<RecycleBinSectionClient
					deletedEntries={deletedEntries}
					canDelete={data.permissions.canDelete}
					onRefresh={() => fetchFiles(data.currentPath)}
				/>
			</section>
		</section>
	);
}
