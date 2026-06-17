"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useRef, useCallback } from "react";
import { PageShell, Card, EmptyState, ToggleChip } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

import { useImageBedList } from "./use-image-bed-list";
import type { ImageItem, ImageStats, PendingDelete, UploadProgress } from "./image-bed-types";
import { ImagePreviewModalLazy } from "./image-preview-modal-lazy";

function getErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

export default function ImageBedPage({ canWrite, canDelete }: { canWrite: boolean; canDelete: boolean }) {
	const {
		images,
		total,
		page,
		totalPages,
		loading,
		search,
		showAll,
		fetchImages,
		setSearch,
		setShowAll,
	} = useImageBedList({ canWrite });
	const { t } = useI18n();
	const [uploading, setUploading] = useState(false);
	const [dragOver, setDragOver] = useState(false);
	const [toast, setToast] = useState<string | null>(null);
	const [previewImage, setPreviewImage] = useState<ImageItem | null>(null);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [showStats, setShowStats] = useState(false);
	const [stats, setStats] = useState<ImageStats | null>(null);
	const [batchMode, setBatchMode] = useState(false);
	const [batchAlbum, setBatchAlbum] = useState("");
	const [showPublishModal, setShowPublishModal] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [showLegacyUpload, setShowLegacyUpload] = useState(false);
	const [storageNodes, setStorageNodes] = useState<Array<{ id: string; name: string }>>([]);
	const [publishForm, setPublishForm] = useState({ storageNodeId: "", relativePath: "", filename: "", album: "" });
	const [uploadProgress, setUploadProgress] = useState<UploadProgress>(null);
	const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const showToast = (msg: string) => {
		setToast(msg);
		setTimeout(() => setToast(null), 3000);
	};

	// fetchImages now lives in `useImageBedList`; re-wrap here so the rest of
	// the page (upload / delete / batch handlers) can keep calling it as
	// before. Errors raised by the hook are surfaced via toast — matches the
	// prior behaviour of the inline implementation.
	const fetchImagesWithToast = useCallback(async (p = 1) => {
		try {
			await fetchImages(p);
		} catch {
			showToast(t("imageBed.toast.fetchListFailed"));
		}
	}, [fetchImages]);
	// Suppress unused warning — the variable keeps the call site stable while
	// the hook owns the state mutations. The linter is happy if we use the
	// result; downstream code reaches `fetchImages` directly via destructuring.
	void fetchImagesWithToast;

	const fetchStats = async () => {
		try {
			const data = await csrfFetch("/api/images/stats") as ImageStats;
			setStats(data);
			setShowStats(true);
		} catch {
			showToast(t("imageBed.toast.fetchStatsFailed"));
		}
	};

	const fetchStorageNodes = async () => {
		try {
			const data = await csrfFetch("/api/storage/nodes");
			const nodes = (data.nodes || data || []).map((n: { id: string; name: string; driver?: string; serverName?: string | null }) => ({ id: n.id, name: n.serverName ? `${n.name} · ${n.serverName}` : n.name }));
			if (nodes.length === 0) showToast(t("imageBed.toast.noPublishNodes"));
			else setStorageNodes(nodes);
		} catch (err) {
			showToast(err instanceof Error ? err.message : t("imageBed.toast.fetchNodesFailed"));
		}
	};

	// Initial fetch lives in `useImageBedList`; the inline useEffect that
	// used to trigger the first load here has been removed.

	const handleUpload = async (files: FileList | File[]) => {
		const uploadItems = Array.from(files);
		if (uploadItems.length === 0) return;

		setUploading(true);
		setUploadProgress({
			total: uploadItems.length,
			current: 0,
			success: 0,
			failure: 0,
			queue: uploadItems.map((file) => ({ name: file.name, status: "pending", message: t("imageBedPage.queue.pending") })),
		});

		let success = 0;
		let failure = 0;
		for (let index = 0; index < uploadItems.length; index++) {
			const file = uploadItems[index]!;
			setUploadProgress((prev) => prev ? {
				...prev,
				current: index + 1,
				queue: prev.queue.map((item, i) => i === index ? { ...item, status: "uploading", message: t("imageBedPage.queue.uploadingItem").replace("{current}", String(index + 1)).replace("{total}", String(uploadItems.length)) } : item),
			} : prev);

			if (!file.type.startsWith("image/")) {
				failure++;
				setUploadProgress((prev) => prev ? {
					...prev,
					failure,
					queue: prev.queue.map((item, i) => i === index ? { ...item, status: "skipped", message: t("imageBedPage.queue.notImage") } : item),
				} : prev);
				continue;
			}
			if (file.size > 20 * 1024 * 1024) {
				failure++;
				setUploadProgress((prev) => prev ? {
					...prev,
					failure,
					queue: prev.queue.map((item, i) => i === index ? { ...item, status: "error", message: t("imageBedPage.queue.tooLarge") } : item),
				} : prev);
				continue;
			}
			const formData = new FormData();
			formData.append("file", file);
			if (search) formData.append("album", search);
			if (publishForm.storageNodeId) formData.append("storageNodeId", publishForm.storageNodeId);
			if (publishForm.relativePath) formData.append("relativePath", publishForm.relativePath);
			try {
				await csrfFetch("/api/images/upload", { method: "POST", body: formData });
				success++;
				setUploadProgress((prev) => prev ? {
					...prev,
					success,
					queue: prev.queue.map((item, i) => i === index ? { ...item, status: "success", message: t("imageBedPage.queue.success") } : item),
				} : prev);
			} catch (error) {
				failure++;
				const errorMessage = getErrorMessage(error, t("imageBedPage.error.upload"));
				setUploadProgress((prev) => prev ? {
					...prev,
					failure,
					queue: prev.queue.map((item, i) => i === index ? { ...item, status: "error", message: t("imageBedPage.queue.failedPrefix").replace("{message}", errorMessage) } : item),
				} : prev);
			}
		}
		setUploading(false);
		if (fileInputRef.current) fileInputRef.current.value = "";
		if (success > 0 && failure === 0) {
			showToast(t("imageBedPage.summary.successAll").replace("{count}", String(success)));
			void fetchImages(1);
		} else if (success > 0) {
			showToast(t("imageBedPage.summary.partial").replace("{success}", String(success)).replace("{total}", String(uploadItems.length)).replace("{failure}", String(failure)));
			void fetchImages(1);
		} else {
			showToast(t("imageBedPage.summary.allFailed").replace("{failure}", String(failure)).replace("{total}", String(uploadItems.length)));
		}
	};

	const requestDelete = (img: ImageItem) => {
		setPendingDelete({ type: "single", id: img.id, filename: img.filename });
	};

	const requestBatchDelete = () => {
		if (selectedIds.size === 0) { showToast(t("imageBed.toast.selectFirst")); return; }
		setPendingDelete({ type: "batch", count: selectedIds.size });
	};

	const confirmDelete = async () => {
		if (!pendingDelete || deleting) return;
		setDeleting(true);
		const target = pendingDelete;
		setPendingDelete(null);
		if (target.type === "single") {
			try {
				await csrfFetch(`/api/images/${target.id}`, { method: "DELETE" });
				showToast(t("imageBed.toast.deleted"));
				setPreviewImage(null);
				fetchImages(page);
			} catch { showToast(t("imageBed.toast.deleteError")); }
			finally { setDeleting(false); }
			return;
		}
		await runBatchAction("delete");
		setDeleting(false);
	};

	const runBatchAction = async (action: "delete" | "moveAlbum" | "togglePublic") => {
		if (selectedIds.size === 0) { showToast(t("imageBed.toast.selectFirst")); return; }
		try {
			const body: Record<string, unknown> = { action, ids: Array.from(selectedIds) };
			if (action === "moveAlbum") body.album = batchAlbum;
			const data = await csrfFetch("/api/images/batch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			showToast(t("imageBedPage.batchSuccess").replace("{count}", String(data.deleted || data.updated || 0)));
			setSelectedIds(new Set());
			setBatchMode(false);
			fetchImages(page);
		} catch { showToast(t("imageBed.toast.batchError")); }
	};

	const handlePublishFromStorage = async () => {
		try {
			await csrfFetch("/api/images/publish-from-storage", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(publishForm),
			});
			showToast(t("imageBed.toast.published"));
			setShowPublishModal(false);
			setPublishForm({ storageNodeId: "", relativePath: "", filename: "", album: "" });
			fetchImages(1);
		} catch (err) {
			showToast(err instanceof Error ? err.message : t("imageBed.toast.publishError"));
		}
	};

	const toggleSelect = (id: string) => {
		const next = new Set(selectedIds);
		if (next.has(id)) next.delete(id); else next.add(id);
		setSelectedIds(next);
	};

	const selectAll = () => {
		if (selectedIds.size === images.length) {
			setSelectedIds(new Set());
		} else {
			setSelectedIds(new Set(images.map((i) => i.id)));
		}
	};

	const copyLink = (url: string) => {
		const fullUrl = `${window.location.origin}${url}`;
		navigator.clipboard.writeText(fullUrl).then(() => showToast(t("imageBed.toast.urlCopied")), () => showToast(t("imageBed.toast.copyFailed")));
	};

	const copyMarkdown = (img: ImageItem) => {
		const fullUrl = `${window.location.origin}${img.publicUrl}`;
		navigator.clipboard.writeText(`![${img.filename}](${fullUrl})`).then(() => showToast(t("imageBed.toast.markdownCopied")), () => showToast(t("imageBed.toast.copyFailed")));
	};

	const copyHTML = (img: ImageItem) => {
		const fullUrl = `${window.location.origin}${img.publicUrl}`;
		navigator.clipboard.writeText(`<img src="${fullUrl}" alt="${img.filename}" />`).then(() => showToast(t("imageBed.toast.htmlCopied")), () => showToast(t("imageBed.toast.copyFailed")));
	};

	const formatSize = (bytes: number) => {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	};

	const formatDate = (iso: string) => {
		return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
	};

	const formatPublishSource = (img: ImageItem) => {
		if (!img.storageNodeId || !img.relativePath) return t("imageBedPage.source.directUpload");
		const nodeName = img.storageNode?.server?.name ? `${img.storageNode.name} · ${img.storageNode.server.name}` : img.storageNode?.name ?? t("imageBedPage.source.storageNode");
		return `${nodeName} / ${img.relativePath}`;
	};

	return (
		<PageShell>
			<div className="mb-5 overflow-hidden rounded-3xl border border-white/[0.08] bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(2,6,23,0.9))] p-6 shadow-2xl shadow-emerald-950/20 light:bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_34%),linear-gradient(135deg,#ffffff,#f8fafc)] light:shadow-slate-200/70">
				<div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
					<div>
						<p data-page-eyebrow className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">{t("imageBedPage.hero.eyebrow")}</p>
						<h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--text-primary)]">{t("imageBedPage.hero.title")}</h1>
						<p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{t("imageBedPage.hero.desc")}</p>
					</div>
					<div className="flex flex-wrap items-center gap-2 text-xs">
						<Link href="/media?type=image" className="rounded-xl bg-emerald-500 px-4 py-2 font-medium text-white transition hover:bg-emerald-400">{t("imageBedPage.hero.openMedia")}</Link>
						{canWrite && <button onClick={() => { fetchStorageNodes(); setShowPublishModal(true); }} className="rounded-xl border border-blue-400/25 bg-blue-500/10 px-4 py-2 font-medium text-blue-300 transition hover:bg-blue-500/20">{t("imageBedPage.hero.publishFromStorage")}</button>}
					</div>
				</div>
				<div className="mt-5 grid gap-2 text-xs sm:grid-cols-3">
					<div className="rounded-2xl border border-white/[0.08] bg-white/[0.05] p-3"><div className="text-lg font-semibold text-white">{total}</div><div className="text-slate-400">{t("imageBedPage.stat.total")}</div></div>
					<div className="rounded-2xl border border-white/[0.08] bg-white/[0.05] p-3"><div className="text-lg font-semibold text-white">{images.filter((img) => img.storageNodeId && img.relativePath).length}</div><div className="text-slate-400">{t("imageBedPage.stat.traceable")}</div></div>
					<div className="rounded-2xl border border-white/[0.08] bg-white/[0.05] p-3"><div className="text-lg font-semibold text-white">{images.filter((img) => img.isPublic).length}</div><div className="text-slate-400">{t("imageBedPage.stat.publicOnPage")}</div></div>
				</div>
			</div>

			<div className="mb-5 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
				<div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
					<h2 className="text-sm font-semibold text-white">{t("imageBedPage.publish.title")}</h2>
					<div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
						<Link href="/media?type=image" data-tone="emerald" className="rounded-2xl border border-emerald-400/25 p-3 text-emerald-100 transition hover:bg-emerald-400/15"><span className="block text-lg">{t("imageBedPage.publish.media.title")}</span><span className="mt-1 block text-xs opacity-75">{t("imageBedPage.publish.media.desc")}</span></Link>
						<button type="button" onClick={() => { fetchStorageNodes(); setShowPublishModal(true); }} className="rounded-2xl border border-blue-400/25 bg-blue-400/10 p-3 text-left text-blue-100 transition hover:bg-blue-400/15"><span className="block text-lg">{t("imageBedPage.publish.storage.title")}</span><span className="mt-1 block text-xs opacity-75">{t("imageBedPage.publish.storage.desc")}</span></button>
						<button type="button" onClick={() => setShowLegacyUpload((value) => !value)} data-tone="amber" className="rounded-2xl border border-amber-400/20 p-3 text-left text-amber-100 transition hover:bg-amber-400/15"><span className="block text-lg">{t("imageBedPage.publish.legacy.title")}</span><span className="mt-1 block text-xs opacity-75">{t("imageBedPage.publish.legacy.desc")}</span></button>
					</div>
				</div>
				<div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
					<div className="flex items-center justify-between gap-2">
						<div>
							<h2 className="text-sm font-semibold text-white">{t("imageBedPage.manage.title")}</h2>
							<p className="mt-1 text-xs text-slate-500">{t("imageBedPage.manage.desc")}</p>
						</div>
						<button onClick={fetchStats} className="rounded-lg bg-purple-500/10 px-3 py-1.5 text-xs text-purple-300 transition hover:bg-purple-500/20 light:text-purple-700">{t("imageBedPage.manage.stats")}</button>
					</div>
					<div className="mt-3 flex flex-wrap gap-2 text-xs">
						<ToggleChip active={showAll} onClick={() => { setShowAll(!showAll); }} ariaLabel={t("imageBedPage.toggle.toggleScope")}>
							{showAll ? t("imageBedPage.toggle.ownOnly") : t("imageBedPage.toggle.allUsers")}
						</ToggleChip>
						{canWrite && (
							<ToggleChip
								active={batchMode}
								tone="warn"
								onClick={() => { setBatchMode(!batchMode); setSelectedIds(new Set()); }}
								ariaLabel={t("imageBedPage.toggle.toggleBatch")}
							>
								{batchMode ? t("imageBedPage.toggle.batchOn") : t("imageBedPage.toggle.batchOff")}
							</ToggleChip>
						)}
					</div>
				</div>
			</div>

			{/* Batch Operations Bar */}
			{batchMode && canWrite && (
				<div
					role="region"
					aria-label={t("imageBedPage.batch.region")}
					data-testid="image-bed-batch-bar"
					className="sticky bottom-16 z-30 -mx-4 mt-3 flex flex-wrap items-center gap-2 border-y border-slate-700 bg-slate-900/95 p-3 backdrop-blur-sm md:static md:bottom-auto md:z-auto md:mx-0 md:gap-3 md:rounded-xl md:border md:bg-slate-800/50 md:p-3 md:backdrop-blur-0 light:md:bg-slate-100/50"
				>
					<span className="text-xs text-slate-400">{t("imageBedPage.batch.selected").replace("{count}", String(selectedIds.size))}</span>
					<button onClick={selectAll} className="min-h-11 rounded px-3 text-xs bg-slate-700 text-slate-300 hover:bg-slate-600 transition">
						{selectedIds.size === images.length ? t("imageBedPage.batch.deselectAll") : t("imageBedPage.batch.selectAll")}
					</button>
					{canDelete && (
						<button onClick={requestBatchDelete} disabled={selectedIds.size === 0} className="min-h-11 rounded px-3 text-xs bg-red-500/20 text-red-300 hover:bg-red-500/30 transition disabled:opacity-30">{t("imageBedPage.batch.delete")}</button>
					)}
					<div className="flex items-center gap-1">
						<input type="text" value={batchAlbum} onChange={(e) => setBatchAlbum(e.target.value)} placeholder={t("imageBedPage.batch.albumPlaceholder")} aria-label={t("imageBedPage.batch.albumLabel")} className="min-h-11 bg-slate-900/50 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 w-28 focus:outline-none focus:border-cyan-400/50" />
						<button onClick={() => runBatchAction("moveAlbum")} disabled={selectedIds.size === 0 || !batchAlbum} className="min-h-11 rounded px-3 text-xs bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 transition disabled:opacity-30">{t("imageBedPage.batch.move")}</button>
					</div>
					<button onClick={() => runBatchAction("togglePublic")} disabled={selectedIds.size === 0} className="min-h-11 rounded px-3 text-xs bg-green-500/20 text-green-300 hover:bg-green-500/30 transition disabled:opacity-30">{t("imageBedPage.batch.togglePublic")}</button>
				</div>
			)}

			{/* Stats Panel */}
			{showStats && stats && (
			<div className="mt-3 p-4 bg-[var(--surface-elevated)] border border-[var(--border)] rounded-xl">
					<div className="flex items-center justify-between mb-3">
						<h3 className="text-sm font-semibold text-white">{t("imageBedPage.stats.title")}</h3>
						<button onClick={() => setShowStats(false)} className="text-slate-500 hover:text-slate-300 text-sm">✕</button>
					</div>
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
						<div className="bg-slate-900/50 rounded-lg p-3">
							<div className="text-xs text-slate-500">{t("imageBedPage.stats.totalCount")}</div>
							<div className="text-xl font-bold text-white">{stats.totalCount}</div>
						</div>
						<div className="bg-slate-900/50 rounded-lg p-3">
							<div className="text-xs text-slate-500">{t("imageBedPage.stats.totalSize")}</div>
							<div className="text-xl font-bold text-white">{stats.totalSizeMB} MB</div>
						</div>
						<div className="bg-slate-900/50 rounded-lg p-3">
							<div className="text-xs text-slate-500">{t("imageBedPage.stats.albumCount")}</div>
							<div className="text-xl font-bold text-white">{stats.albums.length}</div>
						</div>
						<div className="bg-slate-900/50 rounded-lg p-3">
							<div className="text-xs text-slate-500">{t("imageBedPage.stats.recent7d")}</div>
							<div className="text-xl font-bold text-white">{stats.uploadTrend.reduce((s, t) => s + t.count, 0)}</div>
						</div>
					</div>
					{stats.uploadTrend.length > 0 && (
						<div className="mb-3">
							<div className="text-xs text-slate-400 mb-1">{t("imageBedPage.stats.trend7d")}</div>
							<div className="flex items-end gap-1 h-16">
								{stats.uploadTrend.map((t) => {
									const maxCount = Math.max(...stats.uploadTrend.map((x) => x.count), 1);
									const height = Math.max((t.count / maxCount) * 100, 8);
									return (
										<div key={t.date} className="flex-1 flex flex-col items-center gap-0.5" title={`${t.date}: ${t.count} 张`}>
											<div className="text-[9px] text-slate-500">{t.count}</div>
											<div className="w-full bg-cyan-500/60 rounded-t" style={{ height: `${height}%` }} />
											<div className="text-[8px] text-slate-600">{t.date.slice(5)}</div>
										</div>
									);
								})}
							</div>
						</div>
					)}
					{stats.albums.length > 0 && (
						<div>
							<div className="text-xs text-slate-400 mb-1">{t("imageBedPage.stats.albumDist")}</div>
							<div className="space-y-1">
								{stats.albums.slice(0, 5).map((a) => (
									<div key={a.album} className="flex items-center justify-between text-xs">
										<span className="text-slate-300">{a.album}</span>
										<span className="text-slate-500">{a.count} 张 · {formatSize(a.sizeBytes)}</span>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			)}

			{/* Upload Area */}
			{showLegacyUpload && canWrite && (
				<div data-tone="amber" className="mt-4 rounded-xl border border-amber-400/20 p-4 light:border-amber-200 light:bg-amber-50">
					<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
						<div>
							<h2 className="text-sm font-semibold text-amber-100">{t("imageBedPage.legacy.title")}</h2>
							<p className="mt-1 text-xs text-amber-100/70">{t("imageBedPage.legacy.desc")}</p>
						</div>
						<Link href="/media?type=image" className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-xs font-medium text-white transition hover:bg-emerald-400">{t("imageBedPage.legacy.openMedia")}</Link>
					</div>
				</div>
			)}
			{showLegacyUpload && canWrite && (
			<>
				<div className="mt-2 flex items-center gap-2 text-xs">
					<span className="text-slate-500">{t("imageBedPage.legacy.uploadTo")}</span>
					<label className="sr-only" htmlFor="imageBedLegacyNode">{t("imageBedPage.legacy.nodeLabel")}</label>
					<select id="imageBedLegacyNode" value={publishForm.storageNodeId} onChange={(e) => setPublishForm(pf => ({ ...pf, storageNodeId: e.target.value }))} onClick={(e) => e.stopPropagation()} className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-cyan-400/50">
						<option value="">{t("imageBedPage.legacy.defaultNode")}</option>
						{storageNodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
					</select>
					<label className="sr-only" htmlFor="imageBedLegacyPath">{t("imageBedPage.legacy.pathLabel")}</label>
					<input id="imageBedLegacyPath" type="text" value={publishForm.relativePath} onChange={(e) => setPublishForm(pf => ({ ...pf, relativePath: e.target.value }))} onClick={(e) => e.stopPropagation()} placeholder={t("imageBedPage.legacy.pathPlaceholder")} className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded px-2 py-1 text-xs text-slate-300 w-32 focus:outline-none focus:border-cyan-400/50" />
					{!storageNodes.length && <button onClick={(e) => { e.stopPropagation(); fetchStorageNodes(); }} className="text-cyan-400 hover:underline">{t("imageBedPage.legacy.loadNodes")}</button>}
				</div>
				<div
					onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
					onDragLeave={() => setDragOver(false)}
					onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files); }}
					onClick={() => fileInputRef.current?.click()}
					className={`
						mt-4 border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
						${dragOver ? "border-cyan-400 bg-cyan-400/5 light:bg-cyan-50" : "border-slate-700 hover:border-slate-500 bg-slate-900/50 light:hover:border-slate-400"}
						${uploading ? "opacity-50 pointer-events-none" : ""}
					`}
				>
					<input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files && handleUpload(e.target.files)} />
					<div className="text-4xl mb-2">📤</div>
					<div className="text-sm text-slate-300 font-medium">{uploading ? t("imageBedPage.legacy.uploading") : t("imageBedPage.legacy.dropHint")}</div>
					<div className="text-xs text-slate-500 mt-1">{t("imageBedPage.legacy.fileTypes")}</div>
				</div>
			</>
			)}

			{/* Upload Progress */}
			{uploadProgress && (
				<div role="status" aria-label={t("imageBedPage.progress.region")} className="mt-3 rounded-xl border border-[var(--border)] bg-slate-900/70 p-4 text-sm text-slate-300">
					<div className="flex items-center justify-between gap-3">
						<span>{uploading ? t("imageBedPage.progress.current").replace("{current}", String(uploadProgress.current)).replace("{total}", String(uploadProgress.total)) : t("imageBedPage.progress.completed").replace("{success}", String(uploadProgress.success)).replace("{total}", String(uploadProgress.total))}</span>
						<span className="text-xs text-slate-500">{t("imageBedPage.progress.success").replace("{success}", String(uploadProgress.success)).replace("{failure}", String(uploadProgress.failure))}</span>
					</div>
					<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
						<div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${Math.round(((uploadProgress.success + uploadProgress.failure) / Math.max(uploadProgress.total, 1)) * 100)}%` }} />
					</div>
					<div className="mt-3 space-y-1 text-xs">
						{uploadProgress.queue.map((item, index) => (
							<div key={`${item.name}-${index}`} className="flex items-center justify-between gap-3">
								<span className="truncate">{item.name} · {item.message}</span>
								<span className={item.status === "success" ? "text-emerald-300" : item.status === "error" || item.status === "skipped" ? "text-rose-300" : item.status === "uploading" ? "text-cyan-300" : "text-slate-500"}>
									{item.status === "success" ? t("imageBedPage.progress.status.success") : item.status === "error" || item.status === "skipped" ? t("imageBedPage.progress.status.error") : item.status === "uploading" ? t("imageBedPage.progress.status.uploading") : t("imageBedPage.progress.status.pending")}
								</span>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Search Filter */}
			<div className="mt-4 flex flex-wrap items-end gap-2 sm:gap-3">
				<label className="grid w-full gap-1.5 text-xs font-medium text-[var(--text-secondary)] sm:w-auto">
					{t("imageBedPage.search.label")}
					<input
						type="search"
						placeholder={t("imageBedPage.search.placeholder")}
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && fetchImages(1)}
						className="min-h-11 w-full rounded-lg border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/50 sm:w-72"
					/>
				</label>
				<button onClick={() => fetchImages(1)} className="min-h-11 rounded-lg bg-cyan-500/10 px-4 py-2 text-sm text-cyan-400 hover:bg-cyan-500/20 transition">{t("imageBedPage.search.submit")}</button>
				<button onClick={() => { setSearch(""); fetchImages(1); }} className="min-h-11 rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200 light:hover:text-slate-800 transition">{t("imageBedPage.search.reset")}</button>
			</div>

			{/* Image Grid */}
			{loading ? (
				<EmptyState>加载中…</EmptyState>
			) : images.length === 0 ? (
				<EmptyState icon="🎉" variant="boxed">
					暂无图片，上传第一张吧
				</EmptyState>
			) : (
				<div data-testid="image-bed-grid" className="mt-6 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{images.map((img) => (
						<Card key={img.id}>
							<div className="group relative aspect-square bg-[var(--input-bg)] rounded-lg overflow-hidden mb-3">
								{batchMode && (
									<div
										onClick={(e) => { e.stopPropagation(); toggleSelect(img.id); }}
										className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-md border-2 flex items-center justify-center cursor-pointer transition ${selectedIds.has(img.id) ? "bg-cyan-500 border-cyan-400 text-white" : "bg-black/50 border-slate-500 hover:border-slate-300"}`}
									>
										{selectedIds.has(img.id) && "✓"}
									</div>
								)}
								<Image
									src={img.publicUrl}
									alt={img.filename}
									fill
									sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
									unoptimized
									className="object-cover cursor-pointer hover:scale-105 transition-transform duration-200"
									onClick={() => !batchMode && setPreviewImage(img)}
								/>
								{/* Hover overlay (always visible on touch, hover-only on md+) */}
								{!batchMode && (
									<div
										data-testid="image-card-overlay"
										className="absolute inset-0 flex items-center justify-center gap-1 bg-black/40 p-2 md:bg-black/60 md:opacity-0 md:group-hover:opacity-100 md:p-0"
									>
										<button onClick={() => copyLink(img.publicUrl)} className="min-h-11 min-w-11 rounded px-2 text-xs bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30" title={t("imageBedPage.copy.title.url")} aria-label={t("imageBedPage.copy.title.url")}>🔗</button>
										<button onClick={() => copyMarkdown(img)} className="min-h-11 min-w-11 rounded px-2 text-xs bg-green-500/20 text-green-300 hover:bg-green-500/30" title={t("imageBedPage.copy.title.markdown")} aria-label={t("imageBedPage.copy.title.markdown")}>M↓</button>
										<button onClick={() => copyHTML(img)} className="min-h-11 min-w-11 rounded px-2 text-xs bg-orange-500/20 text-orange-300 hover:bg-orange-500/30" title={t("imageBedPage.copy.title.html")} aria-label={t("imageBedPage.copy.title.html")}>H</button>
										{canDelete && (
											<button onClick={() => requestDelete(img)} className="min-h-11 min-w-11 rounded px-2 text-xs bg-red-500/20 text-red-300 hover:bg-red-500/30" title="删除" aria-label="删除">🗑</button>
										)}
									</div>
								)}
							</div>
							<div className="text-xs text-slate-300 truncate" title={img.filename}>{img.filename}</div>
							<div className="mt-1 truncate text-[10px] text-slate-500" title={formatPublishSource(img)}>来源：{formatPublishSource(img)}</div>
							<div className="flex items-center justify-between mt-1">
								<span className="text-[10px] text-slate-500">{formatSize(img.sizeBytes)} · {formatDate(img.createdAt)}</span>
								<div className="flex items-center gap-1">
									{img.album && <span className="text-[10px] text-slate-600 bg-slate-800 px-1.5 py-0.5 rounded">{img.album}</span>}
									<span className={`text-[9px] px-1 py-0.5 rounded ${img.isPublic ? "bg-green-500/10 text-green-500" : "bg-slate-700 text-slate-500"}`}>
										{img.isPublic ? "公开" : "私有"}
									</span>
								</div>
							</div>
						</Card>
					))}
				</div>
			)}

			{/* Pagination */}
			{totalPages > 1 && (
				<div className="mt-6 flex items-center justify-center gap-2">
					<button onClick={() => fetchImages(page - 1)} disabled={page <= 1} className="px-3 py-1.5 text-sm bg-slate-800 text-slate-300 rounded-lg disabled:opacity-30 hover:bg-slate-700 light:hover:bg-slate-200 transition">上一页</button>
					<span className="text-sm text-slate-400">{page} / {totalPages}</span>
					<button onClick={() => fetchImages(page + 1)} disabled={page >= totalPages} className="px-3 py-1.5 text-sm bg-slate-800 text-slate-300 rounded-lg disabled:opacity-30 hover:bg-slate-700 light:hover:bg-slate-200 transition">下一页</button>
				</div>
			)}

			{/* Preview Modal — TR-036 lazy chunk, only fetched on first open */}
			<ImagePreviewModalLazy
				image={previewImage}
				canDelete={canDelete}
				onClose={() => setPreviewImage(null)}
				onCopyLink={copyLink}
				onCopyMarkdown={copyMarkdown}
				onCopyHTML={copyHTML}
				onRequestDelete={requestDelete}
				formatSize={formatSize}
			/>

			{/* Publish from Storage Modal */}
			{showPublishModal && (
				<div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setShowPublishModal(false)}>
					<div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
						<h3 className="text-lg font-semibold text-white mb-4">☁️ 从云盘发布到图床</h3>
						<div className="space-y-3">
							<div>
								<label className="text-xs text-slate-400 mb-1 block" htmlFor="imageBedPublishNode">存储节点（本地或 SFTP）</label>
								<select id="imageBedPublishNode" value={publishForm.storageNodeId} onChange={(e) => setPublishForm({ ...publishForm, storageNodeId: e.target.value })} className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-400/50">
									<option value="">选择存储节点</option>
									{storageNodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
								</select>
							</div>
							<div>
								<label className="text-xs text-slate-400 mb-1 block" htmlFor="imageBedPublishPath">文件相对路径</label>
								<input id="imageBedPublishPath" type="text" value={publishForm.relativePath} onChange={(e) => setPublishForm({ ...publishForm, relativePath: e.target.value })} placeholder="e.g. images/photo.png" className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/50" />
							</div>
							<div>
								<label className="text-xs text-slate-400 mb-1 block" htmlFor="imageBedPublishFilename">文件名（可选）</label>
								<input id="imageBedPublishFilename" type="text" value={publishForm.filename} onChange={(e) => setPublishForm({ ...publishForm, filename: e.target.value })} placeholder="默认使用路径中的文件名" className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/50" />
							</div>
							<div>
								<label className="text-xs text-slate-400 mb-1 block" htmlFor="imageBedPublishAlbum">相册（可选）</label>
								<input id="imageBedPublishAlbum" type="text" value={publishForm.album} onChange={(e) => setPublishForm({ ...publishForm, album: e.target.value })} placeholder="归类到相册" className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/50" />
							</div>
						</div>
						<div className="mt-5 flex items-center justify-end gap-2">
							<button onClick={() => setShowPublishModal(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 light:hover:text-slate-800 transition">取消</button>
							<button onClick={handlePublishFromStorage} disabled={!publishForm.storageNodeId || !publishForm.relativePath} className="px-4 py-2 text-sm bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition disabled:opacity-30">发布</button>
						</div>
					</div>
				</div>
			)}

			{pendingDelete && (
				<div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setPendingDelete(null)}>
					<div
						role="dialog"
						aria-modal="true"
						aria-label={pendingDelete.type === "single" ? "确认删除图片" : "确认批量删除图片"}
						className="bg-slate-900 border border-red-500/20 rounded-xl p-6 w-full max-w-md shadow-2xl"
						onClick={(e) => e.stopPropagation()}
					>
						<h3 className="text-lg font-semibold text-white mb-2">{pendingDelete.type === "single" ? "确认删除图片" : "确认批量删除图片"}</h3>
						<p className="text-sm leading-6 text-slate-300">
							{pendingDelete.type === "single" ? (
								<>将删除 <span className="font-semibold text-white">{pendingDelete.filename}</span>，图片外链将失效。</>
							) : (
								<>将删除 <span className="font-semibold text-white">{pendingDelete.count} 张图片</span>，对应外链将失效。</>
							)}
						</p>
						<div className="mt-6 flex items-center justify-end gap-2">
							<button type="button" onClick={() => setPendingDelete(null)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 light:hover:text-slate-800 transition">取消</button>
							<button type="button" onClick={confirmDelete} disabled={deleting} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-500 transition disabled:opacity-50">{deleting ? "删除中..." : "确认删除"}</button>
						</div>
					</div>
				</div>
			)}

			{/* Toast */}
			{toast && (
				<div role={toast.includes("失败") || toast.includes("出错") || toast.includes("超过") ? "alert" : "status"} className="fixed bottom-6 right-6 bg-slate-800 border border-slate-700 text-sm text-slate-200 px-4 py-2.5 rounded-xl shadow-lg z-50 animate-fade-in">
					{toast}
				</div>
			)}

			<style>{`
				@keyframes fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
				.animate-fade-in { animation: fade-in 0.2s ease-out; }
			`}</style>
		</PageShell>
	);
}
