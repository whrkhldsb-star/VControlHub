"use client";

import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { PageShell, EmptyState, ToggleChip } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n/use-locale";

import { useImageBedList } from "./use-image-bed-list";
import { useImageBedActions } from "./use-image-bed-actions";
import type { ImageItem } from "./image-bed-types";
import { ImagePreviewModalLazy } from "./image-preview-modal-lazy";
import { ImageBedStatsPanel, UploadProgressPanel } from "./image-bed-sections";
import { formatImageDate, formatImageSize, formatPublishSource } from "./image-bed-format";
import { DeleteImageDialog, ImageGrid, PublishFromStorageModal } from "./image-bed-grid-and-modals";
import { FloatingToast } from "./floating-toast";

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
		toggleSelect,
		selectAll,
		toggleBatchMode,
		copyLink,
		copyMarkdown,
		copyHTML,
		openPublishModal,
	} = useImageBedActions({ t, search, page, showAll, images, fetchImages });

	const formatSize = formatImageSize;
	const formatDate = (iso: string) => formatImageDate(iso, locale);
	const formatSource = (img: ImageItem) => formatPublishSource(img, t);

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
						<Link href="/media?type=image" data-action-button data-variant="primary" className="px-4 py-2 text-sm font-semibold">{t("imageBedPage.hero.openMedia")}</Link>
						{canWrite && <ActionButton type="button" variant="outline" onClick={openPublishModal} className="px-4 py-2 text-sm font-medium">{t("imageBedPage.hero.publishFromStorage")}</ActionButton>}
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
						{canWrite ? (
						<button type="button" onClick={openPublishModal} className="rounded-2xl border border-[var(--info-border)] bg-[var(--info-bg)] p-3 text-left text-[var(--text-primary)] transition hover:opacity-90"><span className="block text-lg">{t("imageBedPage.publish.storage.title")}</span><span className="mt-1 block text-xs opacity-75">{t("imageBedPage.publish.storage.desc")}</span></button>
						) : (
						<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3 text-left text-[var(--text-muted)] opacity-70"><span className="block text-lg">{t("imageBedPage.publish.storage.title")}</span><span className="mt-1 block text-xs">{t("imageBedPage.publish.storage.desc")}</span></div>
						)}
						<button type="button" onClick={() => setShowLegacyUpload((value) => !value)} data-tone="amber" className="rounded-2xl border border-[var(--warning-border)] p-3 text-left text-[var(--text-primary)] transition hover:bg-[var(--warning-bg)]"><span className="block text-lg">{t("imageBedPage.publish.legacy.title")}</span><span className="mt-1 block text-xs opacity-75">{t("imageBedPage.publish.legacy.desc")}</span></button>
					</div>
				</div>
				<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]">
					<div className="flex items-center justify-between gap-2">
						<div>
							<h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("imageBedPage.manage.title")}</h2>
							<p className="mt-1 text-xs text-[var(--text-muted)]">{t("imageBedPage.manage.desc")}</p>
						</div>
						<button type="button" onClick={fetchStats} data-action-button data-variant="outline" className="!px-3 !py-1.5 !text-xs">{t("imageBedPage.manage.stats")}</button>
					</div>
					<div className="mt-3 flex flex-wrap gap-2 text-xs">
						<ToggleChip active={showAll} onClick={() => { setShowAll(!showAll); }} ariaLabel={t("imageBedPage.toggle.toggleScope")}>
							{showAll ? t("imageBedPage.toggle.ownOnly") : t("imageBedPage.toggle.allUsers")}
						</ToggleChip>
						{canWrite && (
							<ToggleChip
								active={batchMode}
								tone="warn"
								onClick={toggleBatchMode}
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
					<button onClick={selectAll} data-action-button data-variant="secondary" className="!min-h-11 !px-3 !text-xs">
						{selectedIds.size === images.length ? t("imageBedPage.batch.deselectAll") : t("imageBedPage.batch.selectAll")}
					</button>
					{canDelete && (
						<button onClick={requestBatchDelete} disabled={selectedIds.size === 0} data-action-button data-variant="danger" className="!min-h-11 !px-3 !text-xs disabled:opacity-30">{t("imageBedPage.batch.delete")}</button>
					)}
					<div className="flex items-center gap-1">
						<input type="text" value={batchAlbum} aria-label={t("imageBedPage.batch.albumLabel")} onChange={(e) => setBatchAlbum(e.target.value)} placeholder={t("imageBedPage.batch.albumPlaceholder")} className={cn(UI_INPUT, "min-h-11 w-28 px-2 py-1 text-xs")} />
						<ActionButton type="button" variant="ghost" onClick={() => runBatchAction("moveAlbum")} disabled={selectedIds.size === 0 || !batchAlbum} className="min-h-11 px-3 text-xs">{t("imageBedPage.batch.move")}</ActionButton>
					</div>
					<button onClick={() => runBatchAction("togglePublic")} disabled={selectedIds.size === 0} data-action-button data-variant="success" className="!min-h-11 !px-3 !text-xs disabled:opacity-30">{t("imageBedPage.batch.togglePublic")}</button>
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
						<Link href="/media?type=image" data-action-button data-variant="success-solid" className="!px-4 !py-2 !text-xs">{t("imageBedPage.legacy.openMedia")}</Link>
					</div>
				</div>
			)}
			{showLegacyUpload && canWrite && (
			<>
				<div className="mt-2 flex items-center gap-2 text-xs">
					<span className="text-[var(--text-muted)]">{t("imageBedPage.legacy.uploadTo")}</span>
					<label className="sr-only" htmlFor="imageBedLegacyNode">{t("imageBedPage.legacy.nodeLabel")}</label>
					<select id="imageBedLegacyNode" value={publishForm.storageNodeId} onChange={(e) => setPublishForm(pf => ({ ...pf, storageNodeId: e.target.value }))} onClick={(e) => e.stopPropagation()} className={cn(UI_INPUT, "px-2 py-1 text-xs text-[var(--text-secondary)]")}>
						<option value="">{t("imageBedPage.legacy.defaultNode")}</option>
						{storageNodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
					</select>
					<label className="sr-only" htmlFor="imageBedLegacyPath">{t("imageBedPage.legacy.pathLabel")}</label>
					<input id="imageBedLegacyPath" type="text" value={publishForm.relativePath} onChange={(e) => setPublishForm(pf => ({ ...pf, relativePath: e.target.value }))} onClick={(e) => e.stopPropagation()} placeholder={t("imageBedPage.legacy.pathPlaceholder")} className={cn(UI_INPUT, "w-32 px-2 py-1 text-xs text-[var(--text-secondary)]")} />
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
						className={cn(UI_INPUT, "min-h-11 sm:w-72")}
					/>
				</label>
				<ActionButton type="button" variant="ghost" onClick={() => fetchImages(1)} className="min-h-11 px-4 text-sm">{t("imageBedPage.search.submit")}</ActionButton>
				<button onClick={() => { setSearch(""); fetchImages(1); }} data-action-button data-variant="ghost" className="!min-h-11 !px-4 !py-2 !text-sm">{t("imageBedPage.search.reset")}</button>
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
			{totalPages > 1 && (
				<div className="mt-6 flex items-center justify-center gap-2">
					<button onClick={() => fetchImages(page - 1)} disabled={page <= 1} data-action-button data-variant="secondary" className="!px-3 !py-1.5 !text-sm disabled:opacity-30">{t("imageBedPage.pagination.prev")}</button>
					<span className="text-sm text-[var(--text-secondary)]">{page} / {totalPages}</span>
					<button onClick={() => fetchImages(page + 1)} disabled={page >= totalPages} data-action-button data-variant="secondary" className="!px-3 !py-1.5 !text-sm disabled:opacity-30">{t("imageBedPage.pagination.next")}</button>
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
