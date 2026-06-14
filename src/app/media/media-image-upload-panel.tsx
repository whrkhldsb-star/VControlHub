"use client";

import { useRef, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";

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

export function MediaImageUploadPanel() {
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
			if (next.length === 0) setMessage("暂无可用存储节点；仍可上传到默认图床存储。");
		} catch (loadError) {
			setError(getErrorMessage(loadError, "加载存储节点失败"));
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
			queue: uploadItems.map((file) => ({ name: file.name, status: "pending", message: "等待上传" })),
		});

		let success = 0;
		let failure = 0;
		for (let index = 0; index < uploadItems.length; index++) {
			const file = uploadItems[index]!;
			setProgress((prev) => prev ? {
				...prev,
				current: index + 1,
				queue: prev.queue.map((item, i) => i === index ? { ...item, status: "uploading", message: `正在上传第 ${index + 1}/${uploadItems.length} 张` } : item),
			} : prev);

			if (!file.type.startsWith("image/")) {
				failure++;
				setProgress((prev) => prev ? {
					...prev,
					failure,
					queue: prev.queue.map((item, i) => i === index ? { ...item, status: "skipped", message: "失败：不是图片文件" } : item),
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
					queue: prev.queue.map((item, i) => i === index ? { ...item, status: "success", message: "上传完成，已生成图床外链" } : item),
				} : prev);
			} catch (uploadError) {
				failure++;
				const uploadMessage = getErrorMessage(uploadError, "上传失败");
				setProgress((prev) => prev ? {
					...prev,
					failure,
					queue: prev.queue.map((item, i) => i === index ? { ...item, status: "error", message: `失败：${uploadMessage}` } : item),
				} : prev);
			}
		}
		setUploading(false);
		if (fileInputRef.current) fileInputRef.current.value = "";
		if (success > 0) {
			setMessage(`上传完成：成功 ${success} 张${failure ? `，失败 ${failure} 张` : ""}。请点击“扫描媒体索引”刷新图片列表。`);
		} else {
			setError(`上传失败：${failure}/${uploadItems.length} 张未上传`);
		}
	}

	return (
		<section data-tone="emerald" className="mb-5 rounded-2xl border border-emerald-400/20 p-4 light:bg-emerald-50 light:border-emerald-200">
			<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
				<div>
					<h2 className="text-base font-semibold text-emerald-100">图片图床工作区</h2>
					<p className="mt-1 text-xs text-emerald-100/70">在图片模式下统一上传、选择存储位置、生成外链；已有图片可在卡片上点“图床外链”。</p>
				</div>
				<div className="flex flex-wrap items-center gap-2 text-xs">
					<button type="button" onClick={loadNodes} disabled={loadingNodes} className="rounded-lg border border-emerald-300/30 px-3 py-2 text-emerald-100 transition hover:bg-emerald-400/10 disabled:opacity-60">
						{loadingNodes ? "加载节点中..." : nodesLoaded ? "刷新存储节点" : "加载存储节点"}
					</button>
					<button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="rounded-lg bg-emerald-500 px-4 py-2 font-medium text-white transition hover:bg-emerald-400 disabled:opacity-60">
						{uploading ? "上传中..." : "选择图片批量上传"}
					</button>
				</div>
			</div>

			<div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
				<div className="text-xs text-emerald-100/80">
					<label htmlFor="media-image-storage-node" className="block">存储节点</label>
					<select id="media-image-storage-node" value={storageNodeId} onChange={(e) => setStorageNodeId(e.target.value)} onFocus={() => { if (!nodesLoaded && !loadingNodes) void loadNodes(); }} className="mt-1 w-full rounded-lg border border-emerald-300/20 bg-slate-900/60 px-3 py-2 text-sm text-white outline-none focus:border-emerald-300 light:border-emerald-200">
						<option value="">默认图床存储</option>
						{nodes.map((node) => (
							<option key={node.id} value={node.id}>{node.name}{node.driver ? ` · ${node.driver}` : ""}{node.serverName ? ` · ${node.serverName}` : ""}</option>
						))}
					</select>
				</div>
				<div className="text-xs text-emerald-100/80">
					<label htmlFor="media-image-target-path" className="block">上传到存储目录（可改）</label>
					<input id="media-image-target-path" value={targetPath} onChange={(e) => setTargetPath(e.target.value)} placeholder="例如 image-bed/2026" className="mt-1 w-full rounded-lg border border-emerald-300/20 bg-slate-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-300 light:border-emerald-200" />
				</div>
			</div>

			<input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files && void uploadFiles(e.target.files)} />

			{progress ? (
				<div role="status" aria-label="媒体图片上传进度" className="mt-3 rounded-xl border border-emerald-300/20 bg-slate-950/40 p-3 text-xs text-emerald-100">
					<div className="flex justify-between gap-3">
						<span>{uploading ? `正在上传第 ${progress.current}/${progress.total} 张` : `已完成 ${progress.success}/${progress.total} 张`}</span>
						<span>成功 {progress.success} · 失败 {progress.failure}</span>
					</div>
					<div className="mt-2 space-y-1">
						{progress.queue.map((item, index) => <div key={`${item.name}-${index}`} className="flex justify-between gap-3"><span className="truncate">{item.name} · {item.message}</span><span>{item.status === "success" ? "完成" : item.status === "error" || item.status === "skipped" ? "失败" : item.status === "uploading" ? "上传中" : "等待"}</span></div>)}
					</div>
				</div>
			) : null}
			{message ? <p role="status" className="mt-2 text-xs text-emerald-100">{message}</p> : null}
			{error ? <p role="alert" className="mt-2 text-xs text-rose-200">{error}</p> : null}
		</section>
	);
}
