"use client";

import { useRef, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

type StorageNodeOption = {
	id: string;
	name: string;
	driver?: string;
	basePath?: string;
	serverName?: string | null;
};

type UploadQueueItem = {
	name: string;
	status: "pending" | "uploading" | "success" | "error" | "skipped";
	message: string;
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
			queue: uploadItems.map((file) => ({ name: file.name, status: "pending", message: t("mediaUploadPanel.itemPending") })),
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

			if (!file.type.startsWith("image/")) {
				failure++;
				setProgress((prev) => prev ? {
					...prev,
					failure,
					queue: prev.queue.map((item, i) => i === index ? { ...item, status: "skipped", message: t("mediaUploadPanel.itemSkipped") } : item),
				} : prev);
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
		<section data-tone="emerald" className="mb-5 rounded-2xl border border-emerald-400/20 p-4 light:bg-emerald-50 light:border-emerald-200">
			<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
				<div>
					<h2 className="text-base font-semibold text-emerald-100">{t("mediaUploadPanel.heading")}</h2>
					<p className="mt-1 text-xs text-emerald-100/70">{t("mediaUploadPanel.subheading")}</p>
				</div>
				<div className="flex flex-wrap items-center gap-2 text-xs">
					<button type="button" onClick={loadNodes} disabled={loadingNodes} className="rounded-lg border border-emerald-300/30 px-3 py-2 text-emerald-100 transition hover:bg-emerald-400/10 disabled:opacity-60">
						{loadingNodes ? t("mediaUploadPanel.loadingNodes") : nodesLoaded ? t("mediaUploadPanel.refreshNodes") : t("mediaUploadPanel.loadNodes")}
					</button>
					<button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="rounded-lg bg-emerald-500 px-4 py-2 font-medium text-white transition hover:bg-emerald-400 disabled:opacity-60">
						{uploading ? t("mediaUploadPanel.uploading") : t("mediaUploadPanel.chooseFiles")}
					</button>
				</div>
			</div>

			<div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
				<div className="text-xs text-emerald-100/80">
					<label htmlFor="media-image-storage-node" className="block">{t("mediaUploadPanel.storageNodeLabel")}</label>
					<select id="media-image-storage-node" value={storageNodeId} onChange={(e) => setStorageNodeId(e.target.value)} onFocus={() => { if (!nodesLoaded && !loadingNodes) void loadNodes(); }} className="mt-1 w-full rounded-lg border border-emerald-300/20 bg-slate-900/60 px-3 py-2 text-sm text-white outline-none focus:border-emerald-300 light:border-emerald-200">
						<option value="">{t("mediaUploadPanel.defaultStorage")}</option>
						{nodes.map((node) => (
							<option key={node.id} value={node.id}>{node.name}{node.driver ? ` · ${node.driver}` : ""}{node.serverName ? ` · ${node.serverName}` : ""}</option>
						))}
					</select>
				</div>
				<div className="text-xs text-emerald-100/80">
					<label htmlFor="media-image-target-path" className="block">{t("mediaUploadPanel.targetPathLabel")}</label>
					<input id="media-image-target-path" value={targetPath} onChange={(e) => setTargetPath(e.target.value)} placeholder={t("mediaUploadPanel.targetPathPlaceholder")} className="mt-1 w-full rounded-lg border border-emerald-300/20 bg-slate-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-300 light:border-emerald-200" />
				</div>
			</div>

			<input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files && void uploadFiles(e.target.files)} />

			{progress ? (
				<div role="status" aria-label={t("mediaUploadPanel.progressAria")} className="mt-3 rounded-xl border border-emerald-300/20 bg-slate-950/40 p-3 text-xs text-emerald-100">
					<div className="flex justify-between gap-3">
						<span>{uploading
							? t("mediaUploadPanel.progressCurrent").replace("{current}", String(progress.current)).replace("{total}", String(progress.total))
							: t("mediaUploadPanel.progressDone").replace("{success}", String(progress.success)).replace("{total}", String(progress.total))}
						</span>
						<span>{t("mediaUploadPanel.progressStats").replace("{success}", String(progress.success)).replace("{failure}", String(progress.failure))}</span>
					</div>
					<div className="mt-2 space-y-1">
						{progress.queue.map((item, index) => <div key={`${item.name}-${index}`} className="flex justify-between gap-3"><span className="truncate">{item.name} · {item.message}</span><span>{statusBadgeLabel(t, item.status)}</span></div>)}
					</div>
				</div>
			) : null}
			{message ? <p role="status" className="mt-2 text-xs text-emerald-100">{message}</p> : null}
			{error ? <p role="alert" className="mt-2 text-xs text-rose-200">{error}</p> : null}
		</section>
	);
}
