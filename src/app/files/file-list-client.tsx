"use client";

import { useState, useCallback, useTransition, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { OFFICE_MIME_SET, ARCHIVE_MIME_SET, EXTENDED_TEXT_MIME_SET, CSV_MIME_SET, MARKDOWN_MIME_SET } from "@/lib/storage/mime-constants";
import { deleteFileEntryAction } from "../storage/actions";
import { moveFileAction } from "./move-file-action";
import { DeleteConfirmButton } from "./delete-confirm-button";
import { RenameInlineForm } from "./rename-inline-form";
import { MoveInlineForm } from "./move-inline-form";

/* ── helper types ─────────────────────────────────────────────────── */

type StorageEntry = {
	id: string;
	name: string;
	entryType: string;
	mimeType?: string | null;
	relativePath: string;
	sizeLabel: string;
	previewable: boolean;
	directAccess: { mode: string; href?: string; description: string };
	storageNode: { id: string; name: string; driver: string };
	updatedAt?: Date | string;
};

/* ── helper functions ─────────────────────────────────────────────── */

function buildSearchHref(path: string, extra?: Record<string, string>) {
	const params = new URLSearchParams();
	if (path) params.set("path", path);
	if (extra) {
		for (const [key, value] of Object.entries(extra)) {
			if (value) params.set(key, value);
		}
	}
	const qs = params.toString();
	return qs ? `/files?${qs}` : "/files";
}

function buildProxyDownloadHref(entry: StorageEntry) {
	if (entry.storageNode.driver === "SFTP") {
		const params = new URLSearchParams({ nodeId: entry.storageNode.id, path: entry.relativePath });
		return `/api/storage/sftp-download?${params.toString()}`;
	}
	return `/api/storage/local?path=${encodeURIComponent(entry.relativePath)}`;
}

function buildDirectDownloadHref(entry: StorageEntry) {
	if (entry.storageNode.driver === "SFTP" && entry.directAccess.mode === "direct-url" && entry.directAccess.href) {
		return entry.directAccess.href;
	}
	return null;
}

function appendDownloadFlag(href: string) {
	return `${href}${href.includes("?") ? "&" : "?"}download=1`;
}

function buildDownloadHref(entry: StorageEntry) {
	return buildDirectDownloadHref(entry) ?? buildProxyDownloadHref(entry);
}

/* ── EXTENDED_PREVIEW_MIMES: superset for preview eligibility ── */
const EXTENDED_PREVIEW_MIMES = new Set([
	"image/svg+xml",
	"application/x-ndjson",
	"application/sql",
	"application/yaml",
	...EXTENDED_TEXT_MIME_SET,
	...CSV_MIME_SET,
	...MARKDOWN_MIME_SET,
]);

function getPreviewHref(entry: StorageEntry) {
	const mime = entry.mimeType ?? "";
	const isPreviewableMime =
		mime.startsWith("video/") ||
		mime.startsWith("audio/") ||
		mime.startsWith("image/") ||
		mime === "application/pdf" ||
		mime.startsWith("text/") ||
		OFFICE_MIME_SET.has(mime) ||
		ARCHIVE_MIME_SET.has(mime) ||
		EXTENDED_PREVIEW_MIMES.has(mime);
	if (isPreviewableMime) {
		const downloadHref =
			entry.directAccess.mode === "managed-download" && entry.directAccess.href
				? entry.directAccess.href
				: buildDownloadHref(entry);
		const params = new URLSearchParams({
			href: downloadHref,
			name: entry.name,
			type: mime,
			driver: entry.storageNode.driver,
			...(entry.storageNode.id ? { nodeId: entry.storageNode.id } : {}),
			...(entry.relativePath ? { relativePath: entry.relativePath } : {}),
		});
		return `/files/preview?${params.toString()}`;
	}
	return entry.directAccess.mode === "managed-download" && entry.directAccess.href
		? entry.directAccess.href
		: buildDownloadHref(entry);
}

/** Returns a colored SVG file-type icon — much larger & clearer than emoji */
function FileTypeIcon({ entry, size = 40 }: { entry: { entryType: string; mimeType?: string | null }; size?: number }) {
	if (entry.entryType === "DIRECTORY") {
		return (
			<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
				<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" fill="currentColor" fillOpacity="0.15" />
			</svg>
		);
	}
	const mime = entry.mimeType ?? "";
	if (mime.startsWith("image/"))
		return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400"><rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor" fillOpacity="0.12" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>;
	if (mime.startsWith("video/"))
		return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-rose-400"><rect x="2" y="4" width="20" height="16" rx="2" fill="currentColor" fillOpacity="0.12" /><polygon points="10 8 16 12 10 16" fill="currentColor" fillOpacity="0.4" /></svg>;
	if (mime.startsWith("audio/"))
		return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400"><path d="M9 18V5l12-2v13" fill="currentColor" fillOpacity="0.12" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>;
	if (mime.includes("pdf"))
		return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-400"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" fill="currentColor" fillOpacity="0.12" /><path d="M14 2v6h6" /><path d="M10 12h4M10 16h4" /></svg>;
	if (mime.includes("zip") || mime.includes("tar") || mime.includes("gz") || mime.includes("rar") || mime.includes("7z"))
		return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-orange-400"><rect x="2" y="4" width="20" height="16" rx="2" fill="currentColor" fillOpacity="0.12" /><path d="M12 10v4M10 8h4M10 14h4M12 18v.01" /></svg>;
	if (mime.includes("json") || mime.includes("javascript") || mime.includes("typescript") || mime.includes("xml"))
		return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6" fill="currentColor" fillOpacity="0.08" /></svg>;
	if (mime.startsWith("text/"))
		return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" fill="currentColor" fillOpacity="0.08" /><path d="M14 2v6h6" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>;
	return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" fill="currentColor" fillOpacity="0.08" /><path d="M14 2v6h6" /></svg>;
}

function formatDate(date: Date | string): string {
	const d = typeof date === "string" ? new Date(date) : date;
	return d.toLocaleDateString("zh-CN", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}

/** Get thumbnail URL for image files */
function getThumbnailUrl(entry: StorageEntry): string | null {
	const mime = entry.mimeType ?? "";
	if (!mime.startsWith("image/")) return null;
	if (entry.directAccess.mode === "managed-download" && entry.directAccess.href) {
		return entry.directAccess.href;
	}
	return buildDownloadHref(entry);
}

/* ── serialisable folder type (no Map) ────────────────────────────── */

export type FolderProp = {
	name: string;
	displayName?: string;
	path: string;
	entryId?: string | null;
	fileCount: number;
	folderCount: number;
	sourceKeys: string[];
	sourceValues: string[];
};

export type FileProp = {
	id: string;
	name: string;
	entryType: string;
	mimeType?: string | null;
	relativePath: string;
	sizeLabel: string;
	previewable: boolean;
	directAccessMode: string;
	directAccessHref?: string | null;
	directAccessDescription: string;
	storageNodeId: string;
	storageNodeName: string;
	storageNodeDriver: string;
	updatedAt?: string | null;
};

/* ── component props ──────────────────────────────────────────────── */

type FileListClientProps = {
	folders: FolderProp[];
	files: FileProp[];
	canEditLocalFiles: boolean;
	canDelete: boolean;
	currentPath: string;
	searchQuery: string;
	onFolderClick?: (path: string) => void;
	onRefresh?: () => void;
};

/* ── view mode type ───────────────────────────────────────────────── */

type ViewMode = "list" | "grid" | "details";
type BatchProgress = { done: number; total: number; errors: string[] };

function PreviewIcon() {
	return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
}

function DownloadIcon() {
	return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
}

/* ── main component ───────────────────────────────────────────────── */

export function FileListClient({
	folders,
	files,
	canEditLocalFiles,
	canDelete,
	currentPath,
	searchQuery,
	onFolderClick,
	onRefresh,
}: FileListClientProps) {
	const router = useRouter();

	/** Navigate to a folder path */
	const navigateToFolder = useCallback(
		(path: string) => {
			if (onFolderClick) {
				onFolderClick(path);
			} else {
				router.push(buildSearchHref(path), { scroll: false });
			}
		},
		[onFolderClick, router],
	);

/* ── view mode with localStorage persistence ────────────────────── */

	const VIEW_MODE_KEY = "app-file-view-mode";
	const [viewMode, setViewMode] = useState<ViewMode>(() => {
		try {
			const saved = localStorage.getItem(VIEW_MODE_KEY) as ViewMode | null;
			if (saved && ["list", "grid", "details"].includes(saved)) return saved;
		} catch { /* ignore */ }
		return "list";
	});

	const handleViewModeChange = useCallback((mode: ViewMode) => {
		setViewMode(mode);
		try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch { /* ignore */ }
	}, []);

	// Sort state
	type SortKey = "name" | "type" | "size" | "source" | "updated";
	type SortDir = "asc" | "desc";
	const [sortKey, setSortKey] = useState<SortKey>("name");
	const [sortDir, setSortDir] = useState<SortDir>("asc");

	const toggleSort = useCallback((key: SortKey) => {
		setSortKey((prev) => {
			if (prev === key) {
				setSortDir((d) => (d === "asc" ? "desc" : "asc"));
				return key;
			}
			setSortDir("asc");
			return key;
		});
	}, []);

	const sortedFolders = useMemo(() => {
		const arr = [...folders];
		if (sortKey === "name") arr.sort((a, b) => (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name, "zh-CN"));
		if (sortDir === "desc") arr.reverse();
		return arr;
	}, [folders, sortKey, sortDir]);

	const sortedFiles = useMemo(() => {
		const arr = [...files];
		const cmp = (a: FileProp, b: FileProp) => {
			switch (sortKey) {
				case "name": return a.name.localeCompare(b.name, "zh-CN");
				case "type": return (a.mimeType ?? "").localeCompare(b.mimeType ?? "");
				case "size": return (a.sizeLabel ?? "").localeCompare(b.sizeLabel ?? "");
				case "source": return a.storageNodeName.localeCompare(b.storageNodeName, "zh-CN");
				case "updated": return (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "");
				default: return 0;
			}
		};
		arr.sort(cmp);
		if (sortDir === "desc") arr.reverse();
		return arr;
	}, [files, sortKey, sortDir]);

	function SortIcon({ col }: { col: SortKey }) {
		const active = sortKey === col;
		return (
			<button type="button" onClick={() => toggleSort(col)} className="inline-flex items-center gap-1 hover:text-white transition">
				{active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
			</button>
		);
	}

	// Selection state (list view only)
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [batchAction, setBatchAction] = useState<"none" | "confirm-delete" | "deleting" | "moving">("none");
	const [progress, setProgress] = useState<BatchProgress>({ done: 0, total: 0, errors: [] });
	const [moveTargetDir, setMoveTargetDir] = useState("");
	const [moveProgress, setMoveProgress] = useState<BatchProgress>({ done: 0, total: 0, errors: [] });
	const [isPending, startTransition] = useTransition();

	const allFileIds = files.map((f) => f.id);
	const allSelected = files.length > 0 && allFileIds.every((id) => selectedIds.has(id));
	const someSelected = selectedIds.size > 0 && !allSelected;

	const toggleAll = useCallback(() => {
		if (allSelected) { setSelectedIds(new Set()); } else { setSelectedIds(new Set(allFileIds)); }
	}, [allSelected, allFileIds]);

	const toggleOne = useCallback((id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) { next.delete(id); } else { next.add(id); }
			return next;
		});
	}, []);

	const clearSelection = useCallback(() => {
		setSelectedIds(new Set());
		setBatchAction("none");
		setProgress({ done: 0, total: 0, errors: [] });
		setMoveProgress({ done: 0, total: 0, errors: [] });
	}, []);

	const handleBatchDelete = useCallback(() => {
		setBatchAction("deleting");
		const ids = [...selectedIds];
		setProgress({ done: 0, total: ids.length, errors: [] });
		let completed = 0;
		const errors: string[] = [];
		startTransition(async () => {
			for (const id of ids) {
				const file = files.find((item) => item.id === id);
				const formData = new FormData();
				formData.set("fileEntryId", id);
				const result = await deleteFileEntryAction(null, formData);
				completed++;
				if (result?.error) {
					errors.push(`${file?.name ?? id}: ${result.error}`);
				}
				setProgress({ done: completed, total: ids.length, errors: [...errors] });
			}
			if (onRefresh) { onRefresh(); } else { router.refresh(); }
			if (errors.length === 0) {
				clearSelection();
				return;
			}
			setBatchAction("none");
			setSelectedIds(new Set(ids));
			setProgress({ done: completed, total: ids.length, errors: [...errors] });
		});
	}, [selectedIds, files, router, clearSelection, onRefresh]);

	const handleBatchMove = useCallback(() => {
		setBatchAction("moving");
		setMoveTargetDir("");
		setMoveProgress({ done: 0, total: 0, errors: [] });
	}, []);

	const submitBatchMove = useCallback(() => {
		const ids = [...selectedIds];
		const targetDir = moveTargetDir.trim();
		if (!targetDir || ids.length === 0) return;
		setMoveProgress({ done: 0, total: ids.length, errors: [] });
		let completed = 0;
		const errors: string[] = [];
		startTransition(async () => {
			for (const id of ids) {
				const file = files.find((f) => f.id === id);
				if (!file) {
					errors.push(`${id}: 文件不存在`);
					completed++;
					setMoveProgress({ done: completed, total: ids.length, errors: [...errors] });
					continue;
				}
				const formData = new FormData();
				formData.set("fileEntryId", id);
				formData.set("targetDir", targetDir);
				formData.set("currentRelativePath", file.relativePath);
				formData.set("storageNodeId", file.storageNodeId);
				const result = await moveFileAction(null, formData);
				completed++;
				if (result?.error) errors.push(`${file.name}: ${result.error}`);
				setMoveProgress({ done: completed, total: ids.length, errors: [...errors] });
			}
			if (onRefresh) { onRefresh(); } else { router.refresh(); }
			if (errors.length === 0) {
				clearSelection();
				return;
			}
			setBatchAction("none");
			setSelectedIds(new Set(ids));
			setMoveProgress({ done: completed, total: ids.length, errors: [...errors] });
		});
	}, [selectedIds, moveTargetDir, files, router, clearSelection, onRefresh]);

	function toStorageEntry(f: FileProp): StorageEntry {
		return {
			id: f.id,
			name: f.name,
			entryType: f.entryType,
			mimeType: f.mimeType,
			relativePath: f.relativePath,
			sizeLabel: f.sizeLabel,
			previewable: f.previewable,
			directAccess: {
				mode: f.directAccessMode,
				href: f.directAccessHref ?? undefined,
				description: f.directAccessDescription,
			},
			storageNode: {
				id: f.storageNodeId,
				name: f.storageNodeName,
				driver: f.storageNodeDriver,
			},
			updatedAt: f.updatedAt ?? undefined,
		};
	}

	const emptyMessage = searchQuery
		? `未找到匹配 "${searchQuery}" 的文件。`
		: "当前目录暂无内容。";

	/* helper to render file actions for any view */
	function renderDownloadActions(entry: StorageEntry, proxyDownloadUrl: string, directDownloadUrl: string | null, compact = false) {
		if (!directDownloadUrl || directDownloadUrl === proxyDownloadUrl) {
			return (
				<Link
					href={proxyDownloadUrl}
					title="经网站服务器下载"
					aria-label={`经网站服务器下载 ${entry.name}`}
					download
					className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 hover:text-white"
				>
					<DownloadIcon />
				</Link>
			);
		}

		const buttonClass = compact
			? "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[10px] transition"
			: "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition";
		return (
			<div className="flex flex-wrap items-center gap-1" aria-label={`下载流量选择 ${entry.name}`}>
				<span className="text-[10px] text-slate-500">下载流量</span>
				<Link
					href={proxyDownloadUrl}
					title="经网站服务器下载"
					aria-label={`经网站服务器下载 ${entry.name}`}
					download
					className={`${buttonClass} border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white`}
				>
					网站
				</Link>
				<Link
					href={directDownloadUrl}
					title="直连目标服务器下载"
					aria-label={`直连目标服务器下载 ${entry.name}`}
					target="_blank"
					rel="noopener noreferrer"
					className={`${buttonClass} border-emerald-400/30 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/20`}
				>
					直连
				</Link>
			</div>
		);
	}

	/* helper to render file actions for any view */
	function renderFileActions(entry: StorageEntry, proxyDownloadUrl: string, directDownloadUrl: string | null, previewHref: string, compact = false) {
		return (
			<div className="flex items-center gap-1 flex-wrap">
				{entry.previewable ? (
					<Link
						href={previewHref}
						title="预览"
						className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-cyan-400/30 bg-cyan-500/10 text-cyan-100 transition hover:bg-cyan-500/20"
					>
						<PreviewIcon />
					</Link>
				) : null}
				{renderDownloadActions(entry, proxyDownloadUrl, directDownloadUrl, compact)}
				{canEditLocalFiles ? (
					<RenameInlineForm
						fileEntryId={entry.id}
						currentName={entry.name}
						currentPath={entry.relativePath}
						entryType={entry.entryType as "FILE" | "DIRECTORY"}
						onRefresh={onRefresh}
					/>
				) : null}
				{canEditLocalFiles ? (
					<MoveInlineForm
						fileEntryId={entry.id}
						name={entry.name}
						relativePath={entry.relativePath}
						storageNodeId={entry.storageNode.id}
						storageNodeName={entry.storageNode.name}
						onRefresh={onRefresh}
					/>
				) : null}
				{canDelete ? (
					<DeleteConfirmButton
						fileEntryId={entry.id}
						entryName={entry.name}
						entryType={entry.entryType as "FILE" | "DIRECTORY"}
						onRefresh={onRefresh}
					/>
				) : null}
			</div>
		);
	}

	/* ══════════════════════════════════════════════════════════════════ */
	/* ── GRID VIEW (redesigned — large icons, clear buttons) ──────── */
	/* ══════════════════════════════════════════════════════════════════ */

	function renderGridView() {
		return (
			<div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
				{sortedFolders.length === 0 && sortedFiles.length === 0 ? (
					<div className="col-span-full py-16 text-center">
						<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 text-slate-600"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
						<p className="text-sm text-slate-400">{emptyMessage}</p>
					</div>
				) : null}

				{/* Folder cards */}
				{sortedFolders.map((folder) => (
					<button
						key={folder.path}
						type="button"
						onClick={() => navigateToFolder(folder.path)}
						className="group flex flex-col items-center gap-3 rounded-2xl border border-white/[0.06] bg-slate-900/80 p-5 text-center transition-all duration-200 hover:border-amber-400/30 hover:bg-amber-400/[0.04] hover:shadow-lg hover:shadow-amber-400/5"
					>
						<div className="rounded-xl bg-amber-400/10 p-3 transition-colors group-hover:bg-amber-400/20">
							<FileTypeIcon entry={{ entryType: "DIRECTORY" }} size={36} />
						</div>
						<span className="w-full truncate text-sm font-medium text-cyan-100 group-hover:text-white transition">
							{folder.displayName ?? folder.name}
						</span>
						<span className="text-xs text-slate-500">
							{folder.fileCount + folder.folderCount} 项
						</span>
					</button>
				))}

				{/* File cards */}
				{sortedFiles.map((fileProp) => {
					const entry = toStorageEntry(fileProp);
					const thumbUrl = getThumbnailUrl(entry);
					const proxyDownloadHref = buildProxyDownloadHref(entry);
					const proxyDownloadUrl = appendDownloadFlag(proxyDownloadHref);
					const directDownloadUrl = buildDirectDownloadHref(entry);
					const previewHref = getPreviewHref(entry);
					const isChecked = selectedIds.has(fileProp.id);

					return (
						<div
							key={entry.id}
							className={`group relative flex flex-col rounded-2xl border border-white/[0.06] bg-slate-900/80 text-center transition-all duration-200 hover:border-cyan-400/20 hover:shadow-lg hover:shadow-cyan-400/5 overflow-hidden ${isChecked ? "ring-2 ring-cyan-400/50 bg-cyan-400/[0.04]" : ""}`}
						>
							{/* Selection checkbox */}
							<div className="absolute top-2 left-2 z-20">
								<input
									type="checkbox"
									checked={isChecked}
									onChange={() => toggleOne(fileProp.id)}
									aria-label={`选择 ${entry.name}`}
									className="h-4 w-4 rounded accent-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity"
								/>
							</div>

							{/* Thumbnail / icon area */}
							<div className="relative flex items-center justify-center pt-6 pb-2 px-4">
								{thumbUrl ? (
									<div data-testid="file-thumbnail-overlay" className="w-full h-28 rounded-xl overflow-hidden border border-white/[0.06]">
										{/* eslint-disable-next-line @next/next/no-img-element */}
										<img src={thumbUrl} alt={entry.name} width={224} height={112} className="h-full w-full object-cover" loading="lazy" />
									</div>
								) : (
									<div className="rounded-xl bg-white/[0.03] p-4">
										<FileTypeIcon entry={entry} size={44} />
									</div>
								)}
							</div>

							{/* File name & meta */}
							<div className="px-4 pb-2 flex-1 flex flex-col">
								{entry.previewable ? (
									<Link href={previewHref} className="w-full truncate text-sm font-medium text-white hover:text-cyan-100 transition">
										{entry.name}
									</Link>
								) : (
									<span className="w-full truncate text-sm font-medium text-white">{entry.name}</span>
								)}
								<div className="mt-1 flex items-center justify-center gap-2 text-xs text-slate-500">
									<span>{entry.sizeLabel}</span>
									<span className="text-slate-700">·</span>
									<span className="truncate">{entry.storageNode.name}</span>
								</div>
							</div>

						{/* Action bar — always visible, icon buttons */}
							<div className="flex items-center justify-center gap-1 px-3 py-3 border-t border-white/[0.04] bg-slate-950/40">
								{entry.previewable ? (
									<Link
										href={previewHref}
										title="预览"
										className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-cyan-400/30 bg-cyan-500/10 text-cyan-100 transition hover:bg-cyan-500/20"
									>
										<PreviewIcon />
									</Link>
								) : null}
								{renderDownloadActions(entry, proxyDownloadUrl, directDownloadUrl, true)}
								{canEditLocalFiles ? (
									<RenameInlineForm
										fileEntryId={entry.id}
										currentName={entry.name}
										currentPath={entry.relativePath}
										entryType={entry.entryType as "FILE" | "DIRECTORY"}
										onRefresh={onRefresh}
									/>
								) : null}
								{canEditLocalFiles ? (
									<MoveInlineForm
										fileEntryId={entry.id}
										name={entry.name}
										relativePath={entry.relativePath}
										storageNodeId={entry.storageNode.id}
										storageNodeName={entry.storageNode.name}
										onRefresh={onRefresh}
									/>
								) : null}
								{canDelete ? (
									<DeleteConfirmButton
										fileEntryId={entry.id}
										entryName={entry.name}
										entryType={entry.entryType as "FILE" | "DIRECTORY"}
										onRefresh={onRefresh}
									/>
								) : null}
							</div>
						</div>
					);
				})}
			</div>
		);
	}

/* ══════════════════════════════════════════════════════════════════ */
/* ── DETAILS VIEW (redesigned — card rows with clear actions) ─── */
/* ══════════════════════════════════════════════════════════════════ */

	function renderDetailsView() {
		return (
			<div className="divide-y divide-white/[0.04]">
				{sortedFolders.length === 0 && sortedFiles.length === 0 ? (
					<div className="px-6 py-16 text-center">
						<p className="text-sm text-slate-400">{emptyMessage}</p>
					</div>
				) : null}

				{/* Details folder rows */}
				{sortedFolders.map((folder) => (
					<div key={folder.path} className="flex items-center gap-4 px-5 py-4 hover:bg-white/[0.03] transition group">
						<div className="shrink-0">
							<div className="rounded-xl bg-amber-400/10 p-2">
								<FileTypeIcon entry={{ entryType: "DIRECTORY" }} size={28} />
							</div>
						</div>
						<div className="min-w-0 flex-1">
							<button
								type="button"
								onClick={() => navigateToFolder(folder.path)}
								className="truncate font-medium text-cyan-100 hover:text-white transition text-left text-sm"
							>
								{folder.displayName ?? folder.name}
							</button>
							<div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
								<span>目录</span>
								<span>{folder.fileCount + folder.folderCount} 项</span>
							</div>
						</div>
						<div className="shrink-0 flex items-center gap-1">
							<button
								type="button"
								onClick={() => navigateToFolder(folder.path)}
								className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium border border-cyan-400/30 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25 hover:border-cyan-400/50 transition"
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
								打开
							</button>
							{canEditLocalFiles ? (
								<RenameInlineForm
									fileEntryId={folder.entryId ?? ""}
									currentName={folder.displayName ?? folder.name}
									currentPath={folder.path}
									entryType="DIRECTORY"
									onRefresh={onRefresh}
								/>
							) : null}
							{canEditLocalFiles && folder.entryId ? (
								<MoveInlineForm
									fileEntryId={folder.entryId}
									name={folder.displayName ?? folder.name}
									relativePath={folder.path}
									storageNodeId={folder.sourceKeys[0] ?? ""}
									storageNodeName={folder.sourceValues[0] ?? ""}
									onRefresh={onRefresh}
								/>
							) : null}
						</div>
					</div>
				))}

				{/* Details file rows */}
				{sortedFiles.map((fileProp) => {
					const entry = toStorageEntry(fileProp);
					const proxyDownloadHref = buildProxyDownloadHref(entry);
					const proxyDownloadUrl = appendDownloadFlag(proxyDownloadHref);
					const directDownloadUrl = buildDirectDownloadHref(entry);
					const previewHref = getPreviewHref(entry);
					const thumbUrl = getThumbnailUrl(entry);
					const isChecked = selectedIds.has(fileProp.id);

					return (
						<div key={entry.id} className={`flex items-center gap-4 px-5 py-4 hover:bg-white/[0.03] transition ${isChecked ? "bg-cyan-400/[0.04]" : ""}`}>
							{/* Checkbox */}
							<div className="shrink-0">
								<input
									type="checkbox"
									checked={isChecked}
									onChange={() => toggleOne(fileProp.id)}
									aria-label={`选择 ${entry.name}`}
									className="h-4 w-4 rounded accent-cyan-400"
								/>
							</div>

							{/* Thumbnail or colored icon */}
							<div className="shrink-0 w-12 h-12 rounded-xl border border-white/[0.06] bg-slate-900/80 overflow-hidden flex items-center justify-center">
								{thumbUrl ? (
									/* eslint-disable-next-line @next/next/no-img-element */
									<img src={thumbUrl} alt="" width={48} height={48} className="h-full w-full object-cover" loading="lazy" />
								) : (
									<FileTypeIcon entry={entry} size={28} />
								)}
							</div>

							{/* File info */}
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									{entry.previewable ? (
										<Link href={previewHref} className="truncate font-medium text-white hover:text-cyan-100 transition text-sm">
											{entry.name}
										</Link>
									) : (
										<span className="truncate font-medium text-white text-sm">{entry.name}</span>
									)}
								</div>
								<div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
									<span>{entry.mimeType ?? "未知类型"}</span>
									<span>{entry.sizeLabel}</span>
									<span>{entry.storageNode.name}</span>
									{entry.updatedAt ? <span>{formatDate(entry.updatedAt)}</span> : null}
								</div>
							</div>

							{/* Actions — prominent buttons */}
							<div className="shrink-0">
								{renderFileActions(entry, proxyDownloadUrl, directDownloadUrl, previewHref)}
							</div>
						</div>
					);
				})}
			</div>
		);
	}

 /* ══════════════════════════════════════════════════════════════════ */
 /* ── LIST VIEW (redesigned — clean table with pill actions) ──── */
 /* ══════════════════════════════════════════════════════════════════ */

	function renderListView() {
		return (
			<>
			{/* Desktop table view (md+) */}
			<div className="hidden md:block">
				<div className="grid grid-cols-[40px_40px_minmax(0,2fr)_100px_100px_120px_140px_auto] bg-white/5 px-5 py-3 text-xs uppercase tracking-[0.15em] text-slate-400 font-medium">
					<div>
						<input
							type="checkbox"
							checked={allSelected}
							ref={(el) => { if (el) el.indeterminate = someSelected; }}
							onChange={toggleAll}
							disabled={files.length === 0}
							className="rounded h-4 w-4 accent-cyan-400"
						/>
					</div>
					<div />
					<div>名称 <SortIcon col="name" /></div>
					<div>类型 <SortIcon col="type" /></div>
					<div>大小 <SortIcon col="size" /></div>
					<div>来源 <SortIcon col="source" /></div>
					<div>修改时间 <SortIcon col="updated" /></div>
					<div>操作</div>
				</div>

				<div className="divide-y divide-white/[0.04]">
					{sortedFolders.length === 0 && sortedFiles.length === 0 ? (
						<div className="px-6 py-16 text-center text-sm text-slate-400">{emptyMessage}</div>
					) : null}

					{sortedFolders.map((folder) => (
						<div
							key={folder.path}
							className="grid grid-cols-[40px_40px_minmax(0,2fr)_100px_100px_120px_140px_auto] items-center gap-4 px-5 py-3 text-sm hover:bg-white/[0.02] transition"
						>
							<div>
								<input type="checkbox" disabled className="rounded h-4 w-4 accent-cyan-400 opacity-30" />
							</div>
							<div className="flex justify-center">
								<FileTypeIcon entry={{ entryType: "DIRECTORY" }} size={22} />
							</div>
							<div className="min-w-0">
								<button
									type="button"
									onClick={() => navigateToFolder(folder.path)}
									className="truncate font-medium text-cyan-100 hover:text-cyan-50 text-left"
								>
									{folder.displayName ?? folder.name}
								</button>
							</div>
							<div className="text-slate-400">目录</div>
							<div className="text-slate-500">{folder.fileCount + folder.folderCount} 项</div>
							<div className="text-slate-500">—</div>
							<div className="text-slate-500">—</div>
							<div className="flex flex-wrap gap-1">
								<button
									type="button"
									onClick={() => navigateToFolder(folder.path)}
									className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-cyan-400/25 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 transition"
								>
									<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
									打开
								</button>
								{canEditLocalFiles ? (
									<RenameInlineForm
										fileEntryId={folder.entryId ?? ""}
										currentName={folder.displayName ?? folder.name}
										currentPath={folder.path}
										entryType="DIRECTORY"
										onRefresh={onRefresh}
									/>
								) : null}
								{canEditLocalFiles && folder.entryId ? (
									<MoveInlineForm
										fileEntryId={folder.entryId}
										name={folder.displayName ?? folder.name}
										relativePath={folder.path}
										storageNodeId={folder.sourceKeys[0] ?? ""}
										storageNodeName={folder.sourceValues[0] ?? ""}
										onRefresh={onRefresh}
									/>
								) : null}
							</div>
						</div>
					))}

					{sortedFiles.map((fileProp) => {
						const entry = toStorageEntry(fileProp);
						const proxyDownloadHref = buildProxyDownloadHref(entry);
						const proxyDownloadUrl = appendDownloadFlag(proxyDownloadHref);
						const directDownloadUrl = buildDirectDownloadHref(entry);
						const previewHref = getPreviewHref(entry);
						const isChecked = selectedIds.has(fileProp.id);

						return (
							<div
								key={entry.id}
								className={`grid grid-cols-[40px_40px_minmax(0,2fr)_100px_100px_120px_140px_auto] items-center gap-4 px-5 py-3 text-sm hover:bg-white/[0.02] transition ${isChecked ? "bg-cyan-400/[0.04]" : ""}`}
							>
								<div>
									<input
										type="checkbox"
										checked={isChecked}
										onChange={() => toggleOne(fileProp.id)}
										aria-label={`选择 ${entry.name}`}
										className="rounded h-4 w-4 accent-cyan-400"
									/>
								</div>
								<div className="flex justify-center">
									<FileTypeIcon entry={entry} size={22} />
								</div>
								<div className="min-w-0">
									{entry.previewable ? (
										<Link href={previewHref} className="truncate font-medium text-white hover:text-cyan-100 transition">
											{entry.name}
										</Link>
									) : (
										<span className="truncate font-medium text-white">{entry.name}</span>
									)}
									<p className="mt-0.5 truncate text-xs text-slate-600">{entry.relativePath}</p>
								</div>
								<div className="text-slate-400 text-xs">{entry.mimeType?.split("/").pop() ?? "文件"}</div>
								<div className="text-slate-300">{entry.sizeLabel}</div>
								<div className="text-slate-400 truncate text-xs">{entry.storageNode.name}</div>
								<div className="text-slate-500 text-xs">
									{entry.updatedAt ? formatDate(entry.updatedAt) : "—"}
								</div>
							<div className="flex flex-wrap gap-1">
								{entry.previewable ? (
									<Link
										href={previewHref}
										title="预览"
										className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-cyan-400/30 bg-cyan-500/10 text-cyan-100 transition hover:bg-cyan-500/20"
									>
										<PreviewIcon />
									</Link>
								) : null}
								{renderDownloadActions(entry, proxyDownloadUrl, directDownloadUrl, true)}
									{canEditLocalFiles ? (
										<RenameInlineForm
											fileEntryId={entry.id}
											currentName={entry.name}
											currentPath={entry.relativePath}
											entryType={entry.entryType as "FILE" | "DIRECTORY"}
											onRefresh={onRefresh}
										/>
									) : null}
									{canEditLocalFiles ? (
										<MoveInlineForm
											fileEntryId={entry.id}
											name={entry.name}
											relativePath={entry.relativePath}
											storageNodeId={entry.storageNode.id}
											storageNodeName={entry.storageNode.name}
											onRefresh={onRefresh}
										/>
									) : null}
									{canDelete ? (
										<DeleteConfirmButton
											fileEntryId={entry.id}
											entryName={entry.name}
											entryType={entry.entryType as "FILE" | "DIRECTORY"}
											onRefresh={onRefresh}
										/>
									) : null}
								</div>
							</div>
						);
					})}
				</div>
			</div>

			{/* Mobile card view (below md) */}
			<div className="md:hidden divide-y divide-white/[0.04]">
				{sortedFolders.length === 0 && sortedFiles.length === 0 ? (
					<div className="px-6 py-16 text-center text-sm text-slate-400">{emptyMessage}</div>
				) : null}

				{sortedFolders.map((folder) => (
					<div key={folder.path} className="px-4 py-3 hover:bg-white/[0.02] transition">
						<div className="flex items-center gap-3">
							<div className="rounded-lg bg-amber-400/10 p-1.5">
								<FileTypeIcon entry={{ entryType: "DIRECTORY" }} size={20} />
							</div>
							<div className="min-w-0 flex-1">
								<button
									type="button"
									onClick={() => navigateToFolder(folder.path)}
									className="truncate font-medium text-cyan-100 hover:text-cyan-50 text-left text-sm"
								>
									{folder.displayName ?? folder.name}
								</button>
								<div className="mt-0.5 text-xs text-slate-500">{folder.fileCount + folder.folderCount} 项</div>
							</div>
							<button
								type="button"
								onClick={() => navigateToFolder(folder.path)}
								className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-cyan-400/25 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 transition"
							>
								打开
							</button>
						</div>
						{canEditLocalFiles ? (
							<div className="mt-2 flex flex-wrap gap-1 pl-9">
								<RenameInlineForm
									fileEntryId={folder.entryId ?? ""}
									currentName={folder.displayName ?? folder.name}
									currentPath={folder.path}
									entryType="DIRECTORY"
									onRefresh={onRefresh}
								/>
								{folder.entryId ? (
									<MoveInlineForm
										fileEntryId={folder.entryId}
										name={folder.displayName ?? folder.name}
										relativePath={folder.path}
										storageNodeId={folder.sourceKeys[0] ?? ""}
										storageNodeName={folder.sourceValues[0] ?? ""}
										onRefresh={onRefresh}
									/>
								) : null}
							</div>
						) : null}
					</div>
				))}

				{sortedFiles.map((fileProp) => {
					const entry = toStorageEntry(fileProp);
					const proxyDownloadHref = buildProxyDownloadHref(entry);
					const proxyDownloadUrl = appendDownloadFlag(proxyDownloadHref);
					const directDownloadUrl = buildDirectDownloadHref(entry);
					const previewHref = getPreviewHref(entry);
					const isChecked = selectedIds.has(fileProp.id);

					return (
						<div key={entry.id} className={`px-4 py-3 ${isChecked ? "bg-cyan-400/[0.04]" : ""}`}>
							<div className="flex items-start gap-3">
								<input
									type="checkbox"
									checked={isChecked}
									onChange={() => toggleOne(fileProp.id)}
									className="mt-2 rounded h-4 w-4 accent-cyan-400"
								/>
								<div className="shrink-0 mt-0.5 rounded-lg bg-white/[0.03] p-1">
									<FileTypeIcon entry={entry} size={22} />
								</div>
								<div className="min-w-0 flex-1">
									{entry.previewable ? (
										<Link href={previewHref} className="truncate font-medium text-white text-sm hover:text-cyan-100 transition">
											{entry.name}
										</Link>
									) : (
										<span className="truncate font-medium text-white text-sm">{entry.name}</span>
									)}
									<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
										<span>{entry.sizeLabel}</span>
										<span>{entry.storageNode.name}</span>
										{entry.updatedAt ? <span>{formatDate(entry.updatedAt)}</span> : null}
									</div>
								</div>
							</div>
						<div className="mt-2 flex flex-wrap gap-1 pl-9">
								{entry.previewable ? (
									<Link
										href={previewHref}
										title="预览"
										className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-cyan-400/30 bg-cyan-500/10 text-cyan-100 transition hover:bg-cyan-500/20"
									>
										<PreviewIcon />
									</Link>
								) : null}
								{renderDownloadActions(entry, proxyDownloadUrl, directDownloadUrl, true)}
								{canEditLocalFiles ? (
									<RenameInlineForm
										fileEntryId={entry.id}
										currentName={entry.name}
										currentPath={entry.relativePath}
										entryType={entry.entryType as "FILE" | "DIRECTORY"}
										onRefresh={onRefresh}
									/>
								) : null}
								{canEditLocalFiles ? (
									<MoveInlineForm
										fileEntryId={entry.id}
										name={entry.name}
										relativePath={entry.relativePath}
										storageNodeId={entry.storageNode.id}
										storageNodeName={entry.storageNode.name}
										onRefresh={onRefresh}
									/>
								) : null}
								{canDelete ? (
									<DeleteConfirmButton
										fileEntryId={entry.id}
										entryName={entry.name}
										entryType={entry.entryType as "FILE" | "DIRECTORY"}
										onRefresh={onRefresh}
									/>
								) : null}
							</div>
						</div>
					);
				})}
			</div>
			</>
		);
	}

 /* ══════════════════════════════════════════════════════════════════ */
 /* ── MAIN RENDER ────────────────────────────────────────────────── */
 /* ══════════════════════════════════════════════════════════════════ */

	return (
		<>
			<div className="mt-6 overflow-hidden rounded-2xl border border-white/[0.08]">
				{/* View mode toggle header bar */}
				<div className="flex items-center justify-between bg-white/[0.03] px-5 py-2.5 border-b border-white/[0.06]">
					<div className="flex items-center gap-2 text-sm text-slate-400">
						<span>{sortedFolders.length + sortedFiles.length} 项</span>
						{selectedIds.size > 0 ? (
							<span className="text-cyan-300 font-medium">· 已选 {selectedIds.size} 个</span>
						) : null}
					</div>
					<div className="flex items-center gap-1 rounded-xl border border-white/[0.06] bg-slate-950/80 p-1">
						<button
							type="button"
							onClick={() => handleViewModeChange("list")}
							title="列表视图"
							aria-label="列表视图"
							aria-pressed={viewMode === "list"}
							className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
								viewMode === "list"
									? "bg-cyan-400/20 text-cyan-100 border border-cyan-400/30 shadow-sm shadow-cyan-400/10"
									: "text-slate-400 hover:text-white hover:bg-white/5 border border-transparent"
							}`}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
							列表
						</button>
						<button
							type="button"
							onClick={() => handleViewModeChange("grid")}
							title="图标视图"
							aria-label="图标视图"
							aria-pressed={viewMode === "grid"}
							className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
								viewMode === "grid"
									? "bg-cyan-400/20 text-cyan-100 border border-cyan-400/30 shadow-sm shadow-cyan-400/10"
									: "text-slate-400 hover:text-white hover:bg-white/5 border border-transparent"
							}`}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
							图标
						</button>
						<button
							type="button"
							onClick={() => handleViewModeChange("details")}
							title="详情视图"
							aria-label="详情视图"
							aria-pressed={viewMode === "details"}
							className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
								viewMode === "details"
									? "bg-cyan-400/20 text-cyan-100 border border-cyan-400/30 shadow-sm shadow-cyan-400/10"
									: "text-slate-400 hover:text-white hover:bg-white/5 border border-transparent"
							}`}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="3" y1="9" x2="9" y2="9"/><line x1="3" y1="15" x2="9" y2="15"/></svg>
							详情
						</button>
					</div>
				</div>

				{/* View content */}
				{viewMode === "list" ? renderListView() : viewMode === "grid" ? renderGridView() : renderDetailsView()}
			</div>

			{progress.errors.length > 0 || moveProgress.errors.length > 0 ? (
				<div className="fixed bottom-20 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-2xl border border-amber-400/30 bg-amber-950/95 px-4 py-3 text-sm text-amber-100 shadow-2xl">
					<p className="font-medium">
						批量操作完成，{progress.errors.length + moveProgress.errors.length} 个失败
					</p>
					<ul className="mt-1 max-h-28 overflow-y-auto text-xs text-amber-100/80">
						{[...progress.errors, ...moveProgress.errors].map((error) => (
							<li key={error}>• {error}</li>
						))}
					</ul>
				</div>
			) : null}

			{/* Batch action toolbar (all view modes) */}
			{selectedIds.size > 0 ? (
				<div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-slate-900/95 backdrop-blur border border-white/10 rounded-2xl shadow-2xl px-5 py-3">
					{batchAction === "confirm-delete" ? (
						<>
							<span className="text-sm text-rose-200">
								确认删除 {selectedIds.size} 个文件？
							</span>
							<button
								type="button"
								onClick={handleBatchDelete}
								disabled={isPending}
								className="rounded-full border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-400/20 disabled:opacity-50"
							>
								确认删除
							</button>
							<button
								type="button"
								onClick={() => setBatchAction("none")}
								disabled={isPending}
								className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10 disabled:opacity-50"
							>
								取消
							</button>
						</>
					) : batchAction === "deleting" ? (
						<>
							<span className="text-sm text-rose-200">
								已删除 {progress.done}/{progress.total} 个
							</span>
							{progress.done < progress.total ? (
								<div className="h-2 w-24 overflow-hidden rounded-full bg-white/10">
									<div
										className="h-full rounded-full bg-rose-400 transition-all"
										style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
									/>
								</div>
							) : null}
							{progress.errors.length > 0 ? (
								<span className="text-sm text-amber-200">{progress.errors.length} 个失败</span>
							) : null}
						</>
					) : batchAction === "moving" ? (
						<>
							<span className="text-sm text-slate-200">目标路径：</span>
							<input
								type="text"
								value={moveTargetDir}
								onChange={(e) => setMoveTargetDir(e.currentTarget.value)}
								placeholder={currentPath || "目标路径"}
								className="w-40 rounded-2xl border border-white/10 bg-slate-950 px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
							/>
							{moveProgress.total > 0 ? (
								<span className="text-sm text-cyan-200">
									已移动 {moveProgress.done}/{moveProgress.total} 个
									{moveProgress.errors.length > 0 ? `（${moveProgress.errors.length} 个失败）` : ""}
								</span>
							) : null}
							<button
								type="button"
								onClick={submitBatchMove}
								disabled={!moveTargetDir.trim() || isPending || moveProgress.done > 0}
								className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
							>
								确认移动
							</button>
							<button
								type="button"
								onClick={() => {
									setBatchAction("none");
									setMoveTargetDir("");
									setMoveProgress({ done: 0, total: 0, errors: [] });
								}}
								disabled={isPending && moveProgress.done > 0}
								className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10 disabled:opacity-50"
							>
								取消
							</button>
						</>
					) : (
						<>
							<span className="text-sm text-slate-200">已选 {selectedIds.size} 个文件</span>
							<button
								type="button"
								onClick={clearSelection}
								className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10"
							>
								取消选择
							</button>
							{canDelete ? (
								<button
									type="button"
									onClick={() => setBatchAction("confirm-delete")}
									className="rounded-full border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-400/20"
								>
									批量删除
								</button>
							) : null}
							{canEditLocalFiles ? (
								<button
									type="button"
									onClick={handleBatchMove}
									className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20"
								>
									批量移动
								</button>
							) : null}
						</>
					)}
				</div>
			) : null}
		</>
	);
}
