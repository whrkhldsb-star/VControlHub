"use client";

import { useRef, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

import {
	CHUNKED_THRESHOLD_BYTES,
	useChunkedMediaUpload,
	type ChunkedUploadProgress,
} from "@/components/media/chunked-uploader";

type StorageNodeOption = {
	id: string;
	name: string;
	driver?: string;
	basePath?: string;
	serverName?: string | null;
};

type QueueItemMode = "single" | "chunked";

type ChunkedState = {
	progress: ChunkedUploadProgress | null;
};

type UploadQueueItem = {
	name: string;
	size: number;
	mode: QueueItemMode;
	status: "pending" | "uploading" | "success" | "error" | "skipped";
	message: string;
	chunked?: ChunkedState;
};

type UploadProgress = {
	total: number;
	current: number;
	success: number;
	failure: number;
	queue: UploadQueueItem[];
} | null;

function getErrorMessage(error: unknown, fallback: string) {
	return error instanceof Error && error.message ? error.message : fallback;
}

function statusBadgeLabel(t: (k: string) => string, status: UploadQueueItem["status"]): string {
	if (status === "success") return t("mediaUploadPanel.statusSuccess");
	if (status === "error" || status === "skipped") return t("mediaUploadPanel.statusFailed");
	if (status === "uploading") return t("mediaUploadPanel.statusUploading");
	return t("mediaUploadPanel.statusPending");
}

function isImageMime(type: string): boolean {
	return type.startsWith("image/");
}

export function MediaImageUploadPanel() {
	const { t } = useI18n();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [nodes, setNodes] = useState<StorageNodeOption[]>([]);
	const [nodesLoaded, setNodesLoaded] = useState(false);
	const [loadingNodes, setLoadingNodes] = useState(false);
	const [storageNodeId, setStorageNodeId] = useState("");
	const [targetPath, setTargetPath] = useState("image-bed");
	const [uploading, setUploading] = useState(false);
	const [progress, setProgress] = useState<UploadProgress>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const chunked = useChunkedMediaUpload({
		...(storageNodeId ? { storageNodeId } : {}),
		...(targetPath.trim() ? { relativePath: targetPath.trim() } : {}),
		onProgress: (next) => {
			setProgress((prev) =>
				prev
					? {
							...prev,
							queue: prev.queue.map((item) =>
								item.mode === "chunked" && item.chunked
									? { ...item, chunked: { progress: next } }
									: item,
							),
						}
					: prev,
			);
		},
	});

	async function loadNodes() {
		setLoadingNodes(true);
		setError(null);
		try {
			const data = await csrfFetch<{ nodes?: StorageNodeOption[] }>("/api/storage/nodes");
			const next = data.nodes ?? [];
			setNodes(next);
			setNodesLoaded(true);
			if (!storageNodeId && next.length > 0) setStorageNodeId(next[0]!.id);
			if (next.length === 0) setMessage(t("mediaUploadPanel.errorNoNodes"));
		} catch (loadError) {
			setError(getErrorMessage(loadError, t("mediaUploadPanel.errorLoadNodes")));
		} finally {
			setLoadingNodes(false);
		}
	}

	async function uploadChunked(file: File, queueIndex: number): Promise<void> {
		await chunked.upload(file);
		// Mirror server result into queue state. The onProgress handler keeps
		// the per-file progress fresh; here we flip the row's status to
		// "success" once the complete call resolves.
		setProgress((prev) =>
			prev
				? {
						...prev,
						success: prev.success + 1,
						queue: prev.queue.map((item, i) =>
							i === queueIndex
								? {
										...item,
										status: "success",
										message: t("mediaUploadPanel.itemSuccess"),
									}
								: item,
						),
					}
				: prev,
		);
	}

	async function uploadFiles(files: FileList | File[]) {
		const uploadItems = Array.from(files);
		if (uploadItems.length === 0 || uploading) return;
		setUploading(true);
		setMessage(null);
		setError(null);
		setProgress({
			total: uploadItems.length,
			current: 0,
			success: 0,
			failure: 0,
			queue: uploadItems.map((file) => {
				const mode: QueueItemMode = file.size >= CHUNKED_THRESHOLD_BYTES ? "chunked" : "single";
				return {
					name: file.name,
					size: file.size,
					mode,
					status: "pending",
					message: t("mediaUploadPanel.itemPending"),
				};
			}),
		});

		let success = 0;
		let failure = 0;
		for (let index = 0; index < uploadItems.length; index++) {
			const file = uploadItems[index]!;
			const itemUploadingMsg = t("mediaUploadPanel.itemUploading").replace("{current}", String(index + 1)).replace("{total}", String(uploadItems.length));
			setProgress((prev) => prev ? {
				...prev,
				current: index + 1,
				queue: prev.queue.map((item, i) => i === index ? { ...item, status: "uploading", message: itemUploadingMsg } : item),
			} : prev);

			if (!isImageMime(file.type)) {
				failure++;
				setProgress((prev) => prev ? {
					...prev,
					failure,
					queue: prev.queue.map((item, i) => i === index ? { ...item, status: "skipped", message: t("mediaUploadPanel.itemSkipped") } : item),
				} : prev);
				continue;
			}

			if (file.size >= CHUNKED_THRESHOLD_BYTES) {
				// Mark the queue row as chunked so the progress UI shows the badge.
				setProgress((prev) => prev ? {
					...prev,
					queue: prev.queue.map((item, i) => i === index ? { ...item, mode: "chunked", chunked: { progress: null } } : item),
				} : prev);
				try {
					await uploadChunked(file, index);
					success++;
				} catch (uploadError) {
					failure++;
					const uploadMessage = getErrorMessage(uploadError, t("mediaUploadPanel.chunkedError"));
					const itemErrorMsg = t("mediaUploadPanel.itemError").replace("{message}", uploadMessage);
					setProgress((prev) => prev ? {
						...prev,
						failure,
						queue: prev.queue.map((item, i) => i === index ? { ...item, status: "error", message: itemErrorMsg } : item),
					} : prev);
				}
				continue;
			}

			const formData = new FormData();
			formData.append("file", file);
			if (storageNodeId) formData.append("storageNodeId", storageNodeId);
			if (targetPath.trim()) formData.append("relativePath", targetPath.trim());
			try {
				await csrfFetch("/api/images/upload", { method: "POST", body: formData });
				success++;
				setProgress((prev) => prev ? {
					...prev,
					success,
					queue: prev.queue.map((item, i) => i === index ? { ...item, status: "success", message: t("mediaUploadPanel.itemSuccess") } : item),
				} : prev);
			} catch (uploadError) {
				failure++;
				const uploadMessage = getErrorMessage(uploadError, t("mediaUploadPanel.errorUpload"));
				const itemErrorMsg = t("mediaUploadPanel.itemError").replace("{message}", uploadMessage);
				setProgress((prev) => prev ? {
					...prev,
					failure,
					queue: prev.queue.map((item, i) => i === index ? { ...item, status: "error", message: itemErrorMsg } : item),
				} : prev);
			}
		}
		setUploading(false);
		if (fileInputRef.current) fileInputRef.current.value = "";
		if (success > 0) {
			const failurePart = failure > 0 ? t("mediaUploadPanel.summaryFailedPart").replace("{failure}", String(failure)) : "";
			setMessage(t("mediaUploadPanel.summarySuccess").replace("{success}", String(success)).replace("{failureMsg}", failurePart));
		} else {
			setError(t("mediaUploadPanel.summaryFailed").replace("{failure}", String(failure)).replace("{total}", String(uploadItems.length)));
		}
	}

	return (
		<section data-tone="emerald" className="mb-5 rounded-2xl border border-[var(--success-border)] p-4 light:border-[var(--success-border)]">
			<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
				<div>
					<h2 className="text-base font-semibold text-[var(--success)]">{t("mediaUploadPanel.heading")}</h2>
					<p className="mt-1 text-xs text-[var(--success)]/70">{t("mediaUploadPanel.subheading")}</p>
				</div>
				<div className="flex flex-wrap items-center gap-2 text-xs">
					<button type="button" onClick={loadNodes} disabled={loadingNodes} data-action-button data-variant="success" className="!px-3 !py-2 disabled:opacity-60">
						{loadingNodes ? t("mediaUploadPanel.loadingNodes") : nodesLoaded ? t("mediaUploadPanel.refreshNodes") : t("mediaUploadPanel.loadNodes")}
					</button>
					<button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} data-action-button data-variant="success-solid" className="!px-4 !py-2 disabled:opacity-60">
						{uploading ? t("mediaUploadPanel.uploading") : t("mediaUploadPanel.chooseFiles")}
					</button>
				</div>
			</div>

			<div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
				<div className="text-xs text-[var(--text-secondary)]">
					<label htmlFor="media-image-storage-node" className="block">{t("mediaUploadPanel.storageNodeLabel")}</label>
					<select id="media-image-storage-node" value={storageNodeId} onChange={(e) => setStorageNodeId(e.target.value)} onFocus={() => { if (!nodesLoaded && !loadingNodes) void loadNodes(); }} className="mt-1 w-full rounded-lg border border-[var(--success-border)] dark:border-[var(--success-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--success-border)] light:border-[var(--success-border)]">
						<option value="">{t("mediaUploadPanel.defaultStorage")}</option>
						{nodes.map((node) => (
							<option key={node.id} value={node.id}>{node.name}{node.driver ? ` · ${node.driver}` : ""}{node.serverName ? ` · ${node.serverName}` : ""}</option>
						))}
					</select>
				</div>
				<div className="text-xs text-[var(--text-secondary)]">
					<label htmlFor="media-image-target-path" className="block">{t("mediaUploadPanel.targetPathLabel")}</label>
					<input id="media-image-target-path" value={targetPath} onChange={(e) => setTargetPath(e.target.value)} placeholder={t("mediaUploadPanel.targetPathPlaceholder")} className="mt-1 w-full rounded-lg border border-[var(--success-border)] dark:border-[var(--success-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--success-border)] light:border-[var(--success-border)]" />
				</div>
			</div>

			<p className="mt-2 text-[11px] text-[var(--text-muted)]">{t("mediaUploadPanel.chunkedSizeHint")}</p>

			<input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files && void uploadFiles(e.target.files)} />

			{progress ? (
				<div role="status" aria-label={t("mediaUploadPanel.progressAria")} className="mt-3 rounded-xl border border-[var(--success-border)] dark:border-[var(--success-border)] bg-[var(--surface-subtle)] p-3 text-xs text-[var(--text-secondary)]">
					<div className="flex justify-between gap-3">
						<span>{uploading
							? t("mediaUploadPanel.progressCurrent").replace("{current}", String(progress.current)).replace("{total}", String(progress.total))
							: t("mediaUploadPanel.progressDone").replace("{success}", String(progress.success)).replace("{total}", String(progress.total))}
						</span>
						<span>{t("mediaUploadPanel.progressStats").replace("{success}", String(progress.success)).replace("{failure}", String(progress.failure))}</span>
					</div>
					<div className="mt-2 space-y-1">
						{progress.queue.map((item, index) => {
							const isChunked = item.mode === "chunked";
							const chunkedProgress = isChunked ? item.chunked?.progress : null;
							const showChunkedDetail = isChunked && chunkedProgress && (item.status === "uploading" || item.status === "pending");
							return (
								<div key={`${item.name}-${index}`} className="flex flex-wrap items-center justify-between gap-2">
									<span className="truncate">{item.name} · {showChunkedDetail
										? t("mediaUploadPanel.chunkedProgress")
											.replace("{current}", String(chunkedProgress.receivedChunks.length))
											.replace("{total}", String(chunkedProgress.totalChunks))
											.replace("{pct}", String(chunkedProgress.percent))
										: item.message}
										{isChunked ? <span data-tone="emerald" className="ml-2 inline-block rounded border border-[var(--success-border)] px-1.5 py-0.5 text-[10px] text-[var(--success)]">{t("mediaUploadPanel.chunkedBadge")}</span> : null}
									</span>
									<span>{statusBadgeLabel(t, item.status)}</span>
								</div>
							);
						})}
					</div>
					{chunked.progress && chunked.progress.resumed && chunked.progress.skipped > 0 ? (
						<p className="mt-2 text-[11px] text-[var(--success)]/80">{t("mediaUploadPanel.chunkedResumeNotice").replace("{skipped}", String(chunked.progress.skipped))}</p>
					) : null}
				</div>
			) : null}
			{message ? <p role="status" className="mt-2 text-xs text-[var(--success)]">{message}</p> : null}
			{error ? <p role="alert" className="mt-2 text-xs text-[var(--danger)]">{error}</p> : null}
		</section>
	);
}
