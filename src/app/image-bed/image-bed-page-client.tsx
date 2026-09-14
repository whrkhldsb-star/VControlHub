"use client";

import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { PageShell, PageHeader, StatGrid, StatCard, EmptyState, ToggleChip } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n/use-locale";

import { useImageBedList } from "./use-image-bed-list";
import { useImageBedActions } from "./use-image-bed-actions";
import type { ImageItem } from "./image-bed-types";
import { ImagePreviewModalLazy } from "./image-preview-modal-lazy";
import { ImageBedStatsPanel, UploadProgressPanel } from "./image-bed-sections";
import { formatImageDate, formatImageSize, formatPublishSource } from "./image-bed-format";
import { DeleteImageDialog, ImageGrid, PublishFromStorageModal } from "./image-bed-grid-and-modals";
import { FloatingToast } from "./floating-toast";
import { Check, ClipboardList, Folder, HardDrive, ImageIcon, LayoutDashboard, Plus, RefreshCw, Search, Share2, Trash2, User } from "@/components/icons";
import { Pagination } from "@/components/pagination";

export default function ImageBedPage({ canWrite, canDelete, canListAll = false }: { canWrite: boolean; canDelete: boolean; canListAll?: boolean }) {
	const {
		images,
		total,
		page,
		loading,
		error: listError,
		search,
		showAll,
		fetchImages,
		setSearch,
		setShowAll,
	} = useImageBedList({ canWrite });
	const { t, locale } = useI18n();
	const refreshImages = (nextPage = 1, query = search) => fetchImages(nextPage, query).catch(() => {
		// The list hook exposes this failure through the page's visible toast.
	});
	const {
		uploading,
		dragOver,
		setDragOver,
		toast,
		previewImage,
		setPreviewImage,
		selectedIds,
		showStats,
		setShowStats,
		stats,
		batchMode,
		batchAlbum,
		setBatchAlbum,
		showPublishModal,
		setShowPublishModal,
		deleting,
		showLegacyUpload,
		setShowLegacyUpload,
		storageNodes,
		publishForm,
		setPublishForm,
		uploadProgress,
		pendingDelete,
		setPendingDelete,
		fileInputRef,
		fetchStats,
		fetchStorageNodes,
		handleUpload,
		requestDelete,
		requestBatchDelete,
		confirmDelete,
		runBatchAction,
		handlePublishFromStorage,
		batchBusy,
		publishing,
		toggleSelect,
		selectAll,
		toggleBatchMode,
		copyLink,
		copyMarkdown,
		copyHTML,
		openPublishModal,
	} = useImageBedActions({ t, search, page, showAll, images, fetchImages: refreshImages });

	const listToast =
		listError != null
			? { message: t("imageBed.toast.fetchListFailed"), tone: "alert" as const }
			: null;
	const activeToast = toast ?? listToast;

	const formatSize = formatImageSize;
	const formatDate = (iso: string) => formatImageDate(iso, locale);
	const formatSource = (img: ImageItem) => formatPublishSource(img, t);

	return (
		<PageShell>
			<PageHeader eyebrow={t("imageBedPage.hero.eyebrow")} title={t("imageBedPage.hero.title")}>
				<Link href="/media?type=image" data-action-button data-variant="secondary"><ImageIcon size={16} aria-hidden />{t("imageBedPage.hero.openMedia")}</Link>
				{canWrite && <ActionButton type="button" onClick={openPublishModal}><HardDrive size={16} aria-hidden />{t("imageBedPage.hero.publishFromStorage")}</ActionButton>}
				{canWrite && <ActionButton type="button" variant="secondary" aria-expanded={showLegacyUpload} aria-controls="image-bed-upload" onClick={() => setShowLegacyUpload((value) => !value)}><Plus size={16} aria-hidden />{t("imageBedPage.legacy.title")}</ActionButton>}
			</PageHeader>
			<StatGrid cols={3}>
				<StatCard label={t("imageBedPage.stat.total")} value={total} />
				<StatCard label={t("imageBedPage.stat.traceable")} value={images.filter((img) => img.storageNodeId && img.relativePath).length} />
				<StatCard label={t("imageBedPage.stat.publicOnPage")} value={images.filter((img) => img.isPublic).length} />
			</StatGrid>

			<div className="mb-5">
				<div className="min-w-0 border-b border-[var(--border)] py-4">
					<div className="flex items-center justify-between gap-2">
						<div>
							<h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("imageBedPage.manage.title")}</h2>
						</div>
						<ActionButton variant="outline" onClick={fetchStats} className="!px-3 !py-1.5 !text-sm"><LayoutDashboard size={16} aria-hidden />{t("imageBedPage.manage.stats")}</ActionButton>
					</div>
					<div className="mt-3 flex flex-wrap gap-2 text-xs">
						{canListAll && <ToggleChip active={showAll} onClick={() => { setShowAll(!showAll); }} ariaLabel={t("imageBedPage.toggle.toggleScope")}>
							<User size={14} aria-hidden />{t("imageBedPage.toggle.allUsers")}
						</ToggleChip>}
						{canWrite && (
							<ToggleChip
								active={batchMode}
								tone="warn"
								onClick={toggleBatchMode}
								ariaLabel={t("imageBedPage.toggle.toggleBatch")}
							>
								{batchMode ? <Check size={14} aria-hidden /> : <ClipboardList size={14} aria-hidden />}{t("imageBedPage.toggle.batchOff")}
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
					<span className="text-xs text-[var(--text-muted)]">{t("imageBedPage.batch.selected", { count: selectedIds.size })}</span>
					<ActionButton type="button" variant="secondary" onClick={selectAll} className="!min-h-11 !px-3 !text-sm">
						{selectedIds.size === images.length ? t("imageBedPage.batch.deselectAll") : t("imageBedPage.batch.selectAll")}
					</ActionButton>
					{canDelete && (
						<ActionButton type="button" variant="danger" onClick={requestBatchDelete} disabled={batchBusy || selectedIds.size === 0} className="!min-h-11 !px-3 !text-sm disabled:opacity-30"><Trash2 size={16} aria-hidden />{t("imageBedPage.batch.delete")}</ActionButton>
					)}
					<div className="flex items-center gap-1">
						<input type="text" value={batchAlbum} aria-label={t("imageBedPage.batch.albumLabel")} onChange={(e) => setBatchAlbum(e.target.value)} placeholder={t("imageBedPage.batch.albumPlaceholder")} disabled={batchBusy} className={cn(UI_INPUT, "min-h-11 w-28 px-2 py-1 text-xs")} />
						<ActionButton type="button" variant="ghost" onClick={() => runBatchAction("moveAlbum")} disabled={batchBusy || selectedIds.size === 0 || !batchAlbum} className="min-h-11 px-3 text-xs"><Folder size={16} aria-hidden />{t("imageBedPage.batch.move")}</ActionButton>
					</div>
					<ActionButton type="button" variant="success" onClick={() => runBatchAction("togglePublic")} disabled={batchBusy || selectedIds.size === 0} className="!min-h-11 !px-3 !text-sm disabled:opacity-30"><Share2 size={16} aria-hidden />{t("imageBedPage.batch.togglePublic")}</ActionButton>
				</div>
			)}

			{/* Stats Panel */}
			{showStats && stats && (
				<ImageBedStatsPanel stats={stats} onClose={() => setShowStats(false)} t={t} />
			)}

			{/* Upload Area */}
			{showLegacyUpload && canWrite && (
			<section id="image-bed-upload" className="border-b border-[var(--border)] pb-4">
				<div className="mt-2 grid grid-cols-1 items-center gap-2 text-xs sm:grid-cols-3">
					<label className="sr-only" htmlFor="imageBedLegacyNode">{t("imageBedPage.legacy.nodeLabel")}</label>
					<select id="imageBedLegacyNode" value={publishForm.storageNodeId} onChange={(e) => setPublishForm(pf => ({ ...pf, storageNodeId: e.target.value }))} onClick={(e) => e.stopPropagation()} className={cn(UI_INPUT, "px-2 py-1 text-xs text-[var(--text-secondary)]")}>
						<option value="">{t("imageBedPage.legacy.defaultNode")}</option>
						{storageNodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
					</select>
					<label className="sr-only" htmlFor="imageBedLegacyPath">{t("imageBedPage.legacy.pathLabel")}</label>
					<input id="imageBedLegacyPath" type="text" value={publishForm.relativePath} onChange={(e) => setPublishForm(pf => ({ ...pf, relativePath: e.target.value }))} onClick={(e) => e.stopPropagation()} placeholder={t("imageBedPage.legacy.pathPlaceholder")} className={cn(UI_INPUT, "w-32 px-2 py-1 text-xs text-[var(--text-secondary)]")} />
					<label className="sr-only" htmlFor="imageBedUploadAlbum">{t("imageBedPage.legacy.albumLabel")}</label>
					{/* The upload album used to be taken from the search box, which is a
					    substring query — searching "cover" then dropping files created an
					    album named "cover". It is its own field now. */}
					<input id="imageBedUploadAlbum" type="text" value={publishForm.album} onChange={(e) => setPublishForm(pf => ({ ...pf, album: e.target.value }))} onClick={(e) => e.stopPropagation()} placeholder={t("imageBedPage.legacy.albumPlaceholder")} className={cn(UI_INPUT, "w-28 px-2 py-1 text-xs text-[var(--text-secondary)]")} />
					{!storageNodes.length && <button type="button" onClick={(e) => { e.stopPropagation(); fetchStorageNodes(); }} className="text-[var(--color-action)] hover:underline">{t("imageBedPage.legacy.loadNodes")}</button>}
				</div>
				<button
					type="button"
					disabled={uploading}
					onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
					onDragLeave={() => setDragOver(false)}
					onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files); }}
					onClick={() => fileInputRef.current?.click()}
					className={`
						mt-4 w-full border border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
						${dragOver ? "border-[var(--color-action-border)] bg-[var(--color-action-bg)]/5 light:bg-[var(--color-action-bg)]" : "border-[var(--border)] hover:border-[var(--border)] bg-[var(--surface-subtle)] light:hover:border-[var(--border)]"}
						${uploading ? "opacity-50 pointer-events-none" : ""}
					`}
				>
					<ImageIcon size={24} className="mx-auto mb-2 text-[var(--text-muted)]" aria-hidden />
					<span className="block text-sm text-[var(--text-secondary)] font-medium">{uploading ? t("imageBedPage.legacy.uploading") : t("imageBedPage.legacy.dropHint")}</span>
					<span className="block text-xs text-[var(--text-muted)] mt-1">{t("imageBedPage.legacy.fileTypes")}</span>
				</button>
				<input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files) void handleUpload(e.target.files); e.target.value = ""; }} />
			</section>
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
						onKeyDown={(e) => e.key === "Enter" && void refreshImages(1)}
						className={cn(UI_INPUT, "min-h-11 sm:w-72")}
					/>
				</label>
				<ActionButton type="button" variant="ghost" onClick={() => void refreshImages(1)} className="min-h-11 px-4 text-sm"><Search size={16} aria-hidden />{t("imageBedPage.search.submit")}</ActionButton>
				<ActionButton type="button" variant="ghost" onClick={() => { setSearch(""); void refreshImages(1, ""); }} className="!min-h-11 !px-4 !py-2 !text-sm"><RefreshCw size={16} aria-hidden />{t("imageBedPage.search.reset")}</ActionButton>
			</div>

			{/* Image Grid */}
			{loading ? (
				<EmptyState>{t("imageBedPage.loading")}</EmptyState>
			) : images.length === 0 ? (
				<EmptyState icon={<ImageIcon size={24} aria-hidden />}>
					{t("imageBedPage.empty")}
				</EmptyState>
			) : (
				<ImageGrid
					images={images}
					batchMode={batchMode}
					selectedIds={selectedIds}
					canDelete={canDelete}
					formatDate={formatDate}
					formatPublishSource={formatSource}
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
			<Pagination page={page} pageSize={30} totalItems={total} loading={loading} onPageChange={(nextPage) => void refreshImages(nextPage)} />

			{/* Preview Modal — TR-036: mount dynamic chunk only when a preview is open */}
			{previewImage && (
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
			)}

			{/* Publish from Storage Modal */}
			{showPublishModal && (
				<PublishFromStorageModal
					publishForm={publishForm}
					storageNodes={storageNodes}
					handlePublishFromStorage={handlePublishFromStorage}
					setPublishForm={setPublishForm}
					onClose={() => {
						if (publishing) return;
						setShowPublishModal(false);
					}}
					publishing={publishing}
					t={t}
				/>
			)}

			{pendingDelete && (
				<DeleteImageDialog
					pendingDelete={pendingDelete}
					deleting={deleting}
					confirmDelete={confirmDelete}
					onClose={() => {
						if (!deleting) setPendingDelete(null);
					}}
					t={t}
				/>
			)}

			<FloatingToast toast={activeToast} />

		</PageShell>
	);
}
