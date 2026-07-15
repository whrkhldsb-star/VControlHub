"use client";

import Link from "next/link";
import { useState, useRef } from "react";
import { PageShell, EmptyState, ToggleChip } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { toDateLocale } from "@/lib/i18n/locale-format";

import { useImageBedList } from "./use-image-bed-list";
import type { ImageItem, ImageStats, PendingDelete, UploadProgress } from "./image-bed-types";
import { ImagePreviewModalLazy } from "./image-preview-modal-lazy";
import { ImageBedStatsPanel, UploadProgressPanel, formatImageSize } from "./image-bed-sections";
import { DeleteImageDialog, ImageGrid, PublishFromStorageModal } from "./image-bed-grid-and-modals";
import { FloatingToast } from "./floating-toast";

import { ActionButton } from "@/components/action-button";
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
	const { t, locale } = useI18n();
	const [uploading, setUploading] = useState(false);
	const [dragOver, setDragOver] = useState(false);
	const [toast, setToast] = useState<{ message: string; tone: "status" | "alert" } | null>(null);
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

	const showToast = (msg: string, tone: "status" | "alert" = "status") => {
		setToast({ message: msg, tone });
		setTimeout(() => setToast(null), 3000);
	};

	const fetchStats = async () => {
		try {
			const data = await csrfFetch("/api/images/stats") as ImageStats;
			setStats(data);
			setShowStats(true);
		} catch {
			// Failed to fetch image stats — notify the user via toast.
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
			showToast(t("imageBedPage.summary.partial").replace("{success}", String(success)).replace("{total}", String(uploadItems.length)).replace("{failure}", String(failure)), "alert");
			void fetchImages(1);
		} else {
			showToast(t("imageBedPage.summary.allFailed").replace("{failure}", String(failure)).replace("{total}", String(uploadItems.length)), "alert");
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
		if (images.length === 0) return;
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

	const formatSize = formatImageSize;

	const formatDate = (iso: string) => {
		return new Date(iso).toLocaleString(toDateLocale(locale), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
	};

	const formatPublishSource = (img: ImageItem) => {
		if (!img.storageNodeId || !img.relativePath) return t("imageBedPage.source.directUpload");
		const nodeName = img.storageNode?.server?.name ? `${img.storageNode.name} · ${img.storageNode.server.name}` : img.storageNode?.name ?? t("imageBedPage.source.storageNode");
		return `${nodeName} / ${img.relativePath}`;
	};

	return (
		<PageShell>
			<div className="mb-5 overflow-hidden rounded-3xl border border-[var(--border)] bg-[linear-gradient(145deg,color-mix(in_srgb,var(--success-bg)_45%,var(--surface)),var(--surface))] p-5 shadow-[var(--shadow-sm)] sm:p-6">
				<div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
					<div className="min-w-0">
						<p data-page-eyebrow className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">{t("imageBedPage.hero.eyebrow")}</p>
						<h1 className="mt-2 break-words text-[1.75rem] font-semibold leading-snug tracking-[-0.02em] text-[var(--text-primary)] sm:text-[2rem]">{t("imageBedPage.hero.title")}</h1>
						<p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">{t("imageBedPage.hero.desc")}</p>
					</div>
					<div className="flex flex-wrap items-center gap-2 text-xs">
						<Link href="/media?type=image" data-primary className="rounded-xl bg-[var(--accent)] px-4 py-2 font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-hover)]">{t("imageBedPage.hero.openMedia")}</Link>
						{canWrite && <button type="button" onClick={() => { fetchStorageNodes(); setShowPublishModal(true); }} className="rounded-xl border border-[var(--accent-border)] bg-[var(--accent-bg)] px-4 py-2 font-medium text-[var(--accent)] transition hover:bg-[var(--accent-hover)] hover:text-[var(--on-accent)]">{t("imageBedPage.hero.publishFromStorage")}</button>}
					</div>
				</div>
				<div className="mt-5 grid gap-2 text-xs sm:grid-cols-3">
					<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-sm)]"><div className="text-lg font-semibold text-[var(--text-primary)]">{total}</div><div className="text-[var(--text-secondary)]">{t("imageBedPage.stat.total")}</div></div>
					<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-sm)]"><div className="text-lg font-semibold text-[var(--text-primary)]">{images.filter((img) => img.storageNodeId && img.relativePath).length}</div><div className="text-[var(--text-secondary)]">{t("imageBedPage.stat.traceable")}</div></div>
					<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-sm)]"><div className="text-lg font-semibold text-[var(--text-primary)]">{images.filter((img) => img.isPublic).length}</div><div className="text-[var(--text-secondary)]">{t("imageBedPage.stat.publicOnPage")}</div></div>
				</div>
			</div>

			<div className="mb-5 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
				<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]">
					<h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("imageBedPage.publish.title")}</h2>
					<div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
						<Link href="/media?type=image" data-tone="emerald" className="rounded-2xl border border-[var(--success-border)] p-3 text-[var(--text-primary)] transition hover:bg-[var(--success-bg)]"><span className="block text-lg">{t("imageBedPage.publish.media.title")}</span><span className="mt-1 block text-xs opacity-75">{t("imageBedPage.publish.media.desc")}</span></Link>
						<button type="button" onClick={() => { fetchStorageNodes(); setShowPublishModal(true); }} className="rounded-2xl border border-[var(--info-border)] bg-[var(--info-bg)] p-3 text-left text-[var(--text-primary)] transition hover:opacity-90"><span className="block text-lg">{t("imageBedPage.publish.storage.title")}</span><span className="mt-1 block text-xs opacity-75">{t("imageBedPage.publish.storage.desc")}</span></button>
						<button type="button" onClick={() => setShowLegacyUpload((value) => !value)} data-tone="amber" className="rounded-2xl border border-[var(--warning-border)] p-3 text-left text-[var(--text-primary)] transition hover:bg-[var(--warning-bg)]"><span className="block text-lg">{t("imageBedPage.publish.legacy.title")}</span><span className="mt-1 block text-xs opacity-75">{t("imageBedPage.publish.legacy.desc")}</span></button>
					</div>
				</div>
				<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]">
					<div className="flex items-center justify-between gap-2">
						<div>
							<h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("imageBedPage.manage.title")}</h2>
							<p className="mt-1 text-xs text-[var(--text-muted)]">{t("imageBedPage.manage.desc")}</p>
						</div>
						<button type="button" onClick={fetchStats} className="rounded-lg bg-[var(--accent-bg)] px-3 py-1.5 text-xs text-[var(--accent)] transition hover:bg-[var(--accent-bg-hover,var(--accent-bg))]">{t("imageBedPage.manage.stats")}</button>
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
					className="sticky bottom-16 z-30 -mx-4 mt-3 flex flex-wrap items-center gap-2 border-y border-[var(--border)] bg-[var(--modal-bg)] p-3 backdrop-blur-sm md:static md:bottom-auto md:z-auto md:mx-0 md:gap-3 md:rounded-xl md:border md:bg-[var(--surface)] md:p-3 md:backdrop-blur-0"
					>
					<span className="text-xs text-[var(--text-muted)]">{t("imageBedPage.batch.selected").replace("{count}", String(selectedIds.size))}</span>
					<button onClick={selectAll} className="min-h-11 rounded-lg px-3 text-xs bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] transition">
						{selectedIds.size === images.length ? t("imageBedPage.batch.deselectAll") : t("imageBedPage.batch.selectAll")}
					</button>
					{canDelete && (
						<button onClick={requestBatchDelete} disabled={selectedIds.size === 0} className="min-h-11 rounded-lg px-3 text-xs bg-[var(--danger-bg)] text-[var(--danger)] hover:bg-[var(--danger-bg)] transition disabled:opacity-30">{t("imageBedPage.batch.delete")}</button>
					)}
					<div className="flex items-center gap-1">
						<input type="text" value={batchAlbum} aria-label={t("imageBedPage.batch.albumLabel")} onChange={(e) => setBatchAlbum(e.target.value)} placeholder={t("imageBedPage.batch.albumPlaceholder")} className="min-h-11 bg-[var(--input-bg)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] w-28 focus:outline-none focus:border-[var(--color-action-border)]/50" />
						<ActionButton type="button" variant="ghost" onClick={() => runBatchAction("moveAlbum")} disabled={selectedIds.size === 0 || !batchAlbum} className="min-h-11 px-3 text-xs">{t("imageBedPage.batch.move")}</ActionButton>
					</div>
					<button onClick={() => runBatchAction("togglePublic")} disabled={selectedIds.size === 0} className="min-h-11 rounded-lg px-3 text-xs bg-[var(--success-bg)] text-[var(--success)] hover:bg-[var(--success-bg)] transition disabled:opacity-30">{t("imageBedPage.batch.togglePublic")}</button>
				</div>
			)}

			{/* Stats Panel */}
			{showStats && stats && (
				<ImageBedStatsPanel stats={stats} onClose={() => setShowStats(false)} t={t} />
			)}

			{/* Upload Area */}
			{showLegacyUpload && canWrite && (
				<div data-tone="amber" className="mt-4 rounded-xl border border-[var(--warning-border)] p-4 light:border-[var(--warning-border)]">
					<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
						<div>
							<h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("imageBedPage.legacy.title")}</h2>
							<p className="mt-1 text-xs text-[var(--text-primary)]/70">{t("imageBedPage.legacy.desc")}</p>
						</div>
						<Link href="/media?type=image" className="inline-flex items-center justify-center rounded-lg bg-[var(--success)] px-4 py-2 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--success-bg)] hover:text-[var(--success)]">{t("imageBedPage.legacy.openMedia")}</Link>
					</div>
				</div>
			)}
			{showLegacyUpload && canWrite && (
			<>
				<div className="mt-2 flex items-center gap-2 text-xs">
					<span className="text-[var(--text-muted)]">{t("imageBedPage.legacy.uploadTo")}</span>
					<label className="sr-only" htmlFor="imageBedLegacyNode">{t("imageBedPage.legacy.nodeLabel")}</label>
					<select id="imageBedLegacyNode" value={publishForm.storageNodeId} onChange={(e) => setPublishForm(pf => ({ ...pf, storageNodeId: e.target.value }))} onClick={(e) => e.stopPropagation()} className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)] focus:outline-none focus:border-[var(--color-action-border)]/50">
						<option value="">{t("imageBedPage.legacy.defaultNode")}</option>
						{storageNodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
					</select>
					<label className="sr-only" htmlFor="imageBedLegacyPath">{t("imageBedPage.legacy.pathLabel")}</label>
					<input id="imageBedLegacyPath" type="text" value={publishForm.relativePath} onChange={(e) => setPublishForm(pf => ({ ...pf, relativePath: e.target.value }))} onClick={(e) => e.stopPropagation()} placeholder={t("imageBedPage.legacy.pathPlaceholder")} className="bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)] w-32 focus:outline-none focus:border-[var(--color-action-border)]/50" />
					{!storageNodes.length && <button onClick={(e) => { e.stopPropagation(); fetchStorageNodes(); }} className="text-[var(--color-action)] hover:underline">{t("imageBedPage.legacy.loadNodes")}</button>}
				</div>
				<div
					onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
					onDragLeave={() => setDragOver(false)}
					onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files); }}
					onClick={() => fileInputRef.current?.click()}
					className={`
						mt-4 border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
						${dragOver ? "border-[var(--color-action-border)] bg-[var(--color-action-bg)]/5 light:bg-[var(--color-action-bg)]" : "border-[var(--border)] hover:border-[var(--border)] bg-[var(--surface-subtle)] light:hover:border-[var(--border)]"}
						${uploading ? "opacity-50 pointer-events-none" : ""}
					`}
				>
					<input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files && handleUpload(e.target.files)} />
					<div className="text-4xl mb-2">📤</div>
					<div className="text-sm text-[var(--text-secondary)] font-medium">{uploading ? t("imageBedPage.legacy.uploading") : t("imageBedPage.legacy.dropHint")}</div>
					<div className="text-xs text-[var(--text-muted)] mt-1">{t("imageBedPage.legacy.fileTypes")}</div>
				</div>
			</>
			)}

			{/* Upload Progress */}
			<UploadProgressPanel uploadProgress={uploadProgress} uploading={uploading} t={t} />

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
						className="min-h-11 w-full rounded-lg border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--color-action-border)]/50 sm:w-72"
					/>
				</label>
				<ActionButton type="button" variant="ghost" onClick={() => fetchImages(1)} className="min-h-11 px-4 text-sm">{t("imageBedPage.search.submit")}</ActionButton>
				<button onClick={() => { setSearch(""); fetchImages(1); }} className="min-h-11 rounded-lg px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] light:hover:text-[var(--text-disabled)] transition">{t("imageBedPage.search.reset")}</button>
			</div>

			{/* Image Grid */}
			{loading ? (
				<EmptyState>{t("imageBedPage.loading")}</EmptyState>
			) : images.length === 0 ? (
				<EmptyState icon="🎉" variant="boxed">
					{t("imageBedPage.empty")}
				</EmptyState>
			) : (
				<ImageGrid
					images={images}
					batchMode={batchMode}
					selectedIds={selectedIds}
					canDelete={canDelete}
					formatDate={formatDate}
					formatPublishSource={formatPublishSource}
					toggleSelect={toggleSelect}
					setPreviewImage={setPreviewImage}
					copyLink={copyLink}
					copyMarkdown={copyMarkdown}
					copyHTML={copyHTML}
					requestDelete={requestDelete}
					t={t}
				/>
			)}

			{/* Pagination */}
			{totalPages > 1 && (
				<div className="mt-6 flex items-center justify-center gap-2">
					<button onClick={() => fetchImages(page - 1)} disabled={page <= 1} className="px-3 py-1.5 text-sm bg-[var(--surface-hover)] text-[var(--text-secondary)] rounded-lg disabled:opacity-30 hover:bg-[var(--surface-hover)] light:hover:bg-[var(--surface)] transition">{t("imageBedPage.pagination.prev")}</button>
					<span className="text-sm text-[var(--text-secondary)]">{page} / {totalPages}</span>
					<button onClick={() => fetchImages(page + 1)} disabled={page >= totalPages} className="px-3 py-1.5 text-sm bg-[var(--surface-hover)] text-[var(--text-secondary)] rounded-lg disabled:opacity-30 hover:bg-[var(--surface-hover)] light:hover:bg-[var(--surface)] transition">{t("imageBedPage.pagination.next")}</button>
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
				<PublishFromStorageModal
					publishForm={publishForm}
					storageNodes={storageNodes}
					handlePublishFromStorage={handlePublishFromStorage}
					setPublishForm={setPublishForm}
					onClose={() => setShowPublishModal(false)}
					t={t}
				/>
			)}

			{pendingDelete && (
				<DeleteImageDialog
					pendingDelete={pendingDelete}
					deleting={deleting}
					confirmDelete={confirmDelete}
					onClose={() => setPendingDelete(null)}
					t={t}
				/>
			)}

			<FloatingToast toast={toast} />

		</PageShell>
	);
}
