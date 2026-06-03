"use client";

import Image from "next/image";
import { useState, useCallback, useRef, useEffect } from "react";
import { PageShell, Card } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";

type ImageItem = {
	id: string;
	filename: string;
	mimeType: string;
	sizeBytes: number;
	album: string | null;
	isPublic: boolean;
	createdAt: string;
	publicUrl: string;
	user?: { username: string; displayName: string | null };
};

type ImageStats = {
	totalCount: number;
	totalSizeBytes: number;
	totalSizeMB: number;
	albums: Array<{ album: string; count: number; sizeBytes: number }>;
	uploadTrend: Array<{ date: string; count: number }>;
};

type UploadQueueItem = { name: string; status: "pending" | "uploading" | "success" | "error" | "skipped"; message: string };

type UploadProgress = {
	total: number;
	current: number;
	success: number;
	failure: number;
	queue: UploadQueueItem[];
} | null;

type PendingDelete =
	| { type: "single"; id: string; filename: string }
	| { type: "batch"; count: number };

function getErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

export default function ImageBedPage() {
	const [images, setImages] = useState<ImageItem[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [totalPages, setTotalPages] = useState(1);
	const [album, setAlbum] = useState("");
	const [loading, setLoading] = useState(false);
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
	const [storageNodes, setStorageNodes] = useState<Array<{ id: string; name: string }>>([]);
	const [publishForm, setPublishForm] = useState({ storageNodeId: "", relativePath: "", filename: "", album: "" });
	const [uploadProgress, setUploadProgress] = useState<UploadProgress>(null);
	const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const showToast = (msg: string) => {
		setToast(msg);
		setTimeout(() => setToast(null), 3000);
	};

	const fetchImages = useCallback(async (p = 1) => {
		setLoading(true);
		try {
			const params = new URLSearchParams({ page: String(p), limit: "30" });
			if (album) params.set("album", album);
			const data = await csrfFetch(`/api/images/list?${params}`);
			setImages(data.images || []);
			setTotal(data.total || 0);
			setTotalPages(data.totalPages || 1);
			setPage(p);
		} catch {
			showToast("获取图片列表失败");
		} finally {
			setLoading(false);
		}
	}, [album]);

	const fetchStats = async () => {
		try {
			const data = await csrfFetch("/api/images/stats") as ImageStats;
			setStats(data);
			setShowStats(true);
		} catch {
			showToast("获取统计信息失败");
		}
	};

	const fetchStorageNodes = async () => {
		try {
			const data = await csrfFetch("/api/storage/nodes?driver=LOCAL");
			const nodes = (data.nodes || data || []).map((n: { id: string; name: string }) => ({ id: n.id, name: n.name }));
			setStorageNodes(nodes);
			if (nodes.length === 0) showToast("暂无可发布的本地存储节点");
		} catch (err) {
			showToast(err instanceof Error ? err.message : "获取存储节点失败");
		}
	};

	useEffect(() => {
		const timer = window.setTimeout(() => {
			void fetchImages(1);
		}, 0);
		return () => window.clearTimeout(timer);
	}, [fetchImages]);

	const handleUpload = async (files: FileList | File[]) => {
		const uploadItems = Array.from(files);
		if (uploadItems.length === 0) return;

		setUploading(true);
		setUploadProgress({
			total: uploadItems.length,
			current: 0,
			success: 0,
			failure: 0,
			queue: uploadItems.map((file) => ({ name: file.name, status: "pending", message: "等待上传" })),
		});

		let success = 0;
		let failure = 0;
		for (let index = 0; index < uploadItems.length; index++) {
			const file = uploadItems[index];
			setUploadProgress((prev) => prev ? {
				...prev,
				current: index + 1,
				queue: prev.queue.map((item, i) => i === index ? { ...item, status: "uploading", message: `正在上传第 ${index + 1}/${uploadItems.length} 张` } : item),
			} : prev);

			if (!file.type.startsWith("image/")) {
				failure++;
				setUploadProgress((prev) => prev ? {
					...prev,
					failure,
					queue: prev.queue.map((item, i) => i === index ? { ...item, status: "skipped", message: "失败：不是图片文件" } : item),
				} : prev);
				continue;
			}
			if (file.size > 20 * 1024 * 1024) {
				failure++;
				setUploadProgress((prev) => prev ? {
					...prev,
					failure,
					queue: prev.queue.map((item, i) => i === index ? { ...item, status: "error", message: "失败：超过 20MB 限制" } : item),
				} : prev);
				continue;
			}
			const formData = new FormData();
			formData.append("file", file);
			if (album) formData.append("album", album);
			try {
				await csrfFetch("/api/images/upload", { method: "POST", body: formData });
				success++;
				setUploadProgress((prev) => prev ? {
					...prev,
					success,
					queue: prev.queue.map((item, i) => i === index ? { ...item, status: "success", message: "上传完成" } : item),
				} : prev);
			} catch (error) {
				failure++;
				const errorMessage = getErrorMessage(error, "上传失败");
				setUploadProgress((prev) => prev ? {
					...prev,
					failure,
					queue: prev.queue.map((item, i) => i === index ? { ...item, status: "error", message: `失败：${errorMessage}` } : item),
				} : prev);
			}
		}
		setUploading(false);
		if (fileInputRef.current) fileInputRef.current.value = "";
		if (success > 0 && failure === 0) {
			showToast(`✅ 成功上传 ${success} 张图片`);
			void fetchImages(1);
		} else if (success > 0) {
			showToast(`上传完成 ${success}/${uploadItems.length} 张，${failure} 张失败`);
			void fetchImages(1);
		} else {
			showToast(`上传失败：${failure}/${uploadItems.length} 张未上传`);
		}
	};

	const requestDelete = (img: ImageItem) => {
		setPendingDelete({ type: "single", id: img.id, filename: img.filename });
	};

	const requestBatchDelete = () => {
		if (selectedIds.size === 0) { showToast("请先选择图片"); return; }
		setPendingDelete({ type: "batch", count: selectedIds.size });
	};

	const confirmDelete = async () => {
		if (!pendingDelete) return;
		const target = pendingDelete;
		setPendingDelete(null);
		if (target.type === "single") {
			try {
				await csrfFetch(`/api/images/${target.id}`, { method: "DELETE" });
				showToast("✅ 已删除");
				setPreviewImage(null);
				fetchImages(page);
			} catch { showToast("删除出错"); }
			return;
		}
		await runBatchAction("delete");
	};

	const runBatchAction = async (action: "delete" | "moveAlbum" | "togglePublic") => {
		if (selectedIds.size === 0) { showToast("请先选择图片"); return; }
		try {
			const body: Record<string, unknown> = { action, ids: Array.from(selectedIds) };
			if (action === "moveAlbum") body.album = batchAlbum;
			const data = await csrfFetch("/api/images/batch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			showToast(`✅ 批量操作成功，影响 ${data.deleted || data.updated || 0} 张图片`);
			setSelectedIds(new Set());
			setBatchMode(false);
			fetchImages(page);
		} catch { showToast("批量操作出错"); }
	};

	const handlePublishFromStorage = async () => {
		try {
			await csrfFetch("/api/images/publish-from-storage", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(publishForm),
			});
			showToast("✅ 从云盘发布成功");
			setShowPublishModal(false);
			setPublishForm({ storageNodeId: "", relativePath: "", filename: "", album: "" });
			fetchImages(1);
		} catch (err) {
			showToast(err instanceof Error ? err.message : "发布出错");
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
		navigator.clipboard.writeText(fullUrl).then(() => showToast("✅ 外链已复制"), () => showToast("复制失败"));
	};

	const copyMarkdown = (img: ImageItem) => {
		const fullUrl = `${window.location.origin}${img.publicUrl}`;
		navigator.clipboard.writeText(`![${img.filename}](${fullUrl})`).then(() => showToast("✅ Markdown 已复制"), () => showToast("复制失败"));
	};

	const copyHTML = (img: ImageItem) => {
		const fullUrl = `${window.location.origin}${img.publicUrl}`;
		navigator.clipboard.writeText(`<img src="${fullUrl}" alt="${img.filename}" />`).then(() => showToast("✅ HTML 已复制"), () => showToast("复制失败"));
	};

	const formatSize = (bytes: number) => {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	};

	const formatDate = (iso: string) => {
		return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
	};

	return (
		<PageShell>
			{/* Header */}
			<div className="flex items-center justify-between mb-2">
				<div>
					<h1 className="text-3xl font-semibold text-white">图床</h1>
					<p className="mt-1 text-sm text-slate-400">上传图片获取外链，支持拖拽上传和云盘联动</p>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-xs text-slate-500">共 {total} 张图片</span>
					<button onClick={fetchStats} className="px-3 py-1.5 text-xs bg-purple-500/10 text-purple-400 rounded-lg hover:bg-purple-500/20 transition">📊 统计</button>
					<button onClick={() => { fetchStorageNodes(); setShowPublishModal(true); }} className="px-3 py-1.5 text-xs bg-blue-500/10 text-blue-400 rounded-lg hover:bg-blue-500/20 transition">☁️ 云盘发布</button>
					<button onClick={() => { setBatchMode(!batchMode); setSelectedIds(new Set()); }} className={`px-3 py-1.5 text-xs rounded-lg transition ${batchMode ? "bg-amber-500/20 text-amber-300" : "bg-slate-700/50 text-slate-400 hover:bg-slate-700"}`}>
						{batchMode ? "✓ 批量模式" : "☐ 批量模式"}
					</button>
				</div>
			</div>

			{/* Batch Operations Bar */}
			{batchMode && (
				<div className="mt-3 flex items-center gap-3 p-3 bg-slate-800/50 border border-slate-700 rounded-xl">
					<span className="text-xs text-slate-400">已选 {selectedIds.size} 张</span>
					<button onClick={selectAll} className="px-2 py-1 text-xs bg-slate-700 text-slate-300 rounded hover:bg-slate-600 transition">
						{selectedIds.size === images.length ? "取消全选" : "全选"}
					</button>
					<button onClick={requestBatchDelete} disabled={selectedIds.size === 0} className="px-2 py-1 text-xs bg-red-500/20 text-red-300 rounded hover:bg-red-500/30 transition disabled:opacity-30">🗑 批量删除</button>
					<div className="flex items-center gap-1">
						<input type="text" value={batchAlbum} onChange={(e) => setBatchAlbum(e.target.value)} placeholder="目标相册名" className="bg-slate-900/50 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 w-28 focus:outline-none focus:border-cyan-400/50" />
						<button onClick={() => runBatchAction("moveAlbum")} disabled={selectedIds.size === 0 || !batchAlbum} className="px-2 py-1 text-xs bg-cyan-500/20 text-cyan-300 rounded hover:bg-cyan-500/30 transition disabled:opacity-30">📁 移动</button>
					</div>
					<button onClick={() => runBatchAction("togglePublic")} disabled={selectedIds.size === 0} className="px-2 py-1 text-xs bg-green-500/20 text-green-300 rounded hover:bg-green-500/30 transition disabled:opacity-30">🔄 切换公开</button>
				</div>
			)}

			{/* Stats Panel */}
			{showStats && stats && (
				<div className="mt-3 p-4 bg-slate-800/50 border border-slate-700 rounded-xl">
					<div className="flex items-center justify-between mb-3">
						<h3 className="text-sm font-semibold text-white">📊 图床统计</h3>
						<button onClick={() => setShowStats(false)} className="text-slate-500 hover:text-slate-300 text-sm">✕</button>
					</div>
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
						<div className="bg-slate-900/50 rounded-lg p-3">
							<div className="text-xs text-slate-500">总图片数</div>
							<div className="text-xl font-bold text-white">{stats.totalCount}</div>
						</div>
						<div className="bg-slate-900/50 rounded-lg p-3">
							<div className="text-xs text-slate-500">总存储量</div>
							<div className="text-xl font-bold text-white">{stats.totalSizeMB} MB</div>
						</div>
						<div className="bg-slate-900/50 rounded-lg p-3">
							<div className="text-xs text-slate-500">相册数</div>
							<div className="text-xl font-bold text-white">{stats.albums.length}</div>
						</div>
						<div className="bg-slate-900/50 rounded-lg p-3">
							<div className="text-xs text-slate-500">近7天上传</div>
							<div className="text-xl font-bold text-white">{stats.uploadTrend.reduce((s, t) => s + t.count, 0)}</div>
						</div>
					</div>
					{stats.uploadTrend.length > 0 && (
						<div className="mb-3">
							<div className="text-xs text-slate-400 mb-1">📈 上传趋势（近7天）</div>
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
							<div className="text-xs text-slate-400 mb-1">📁 相册分布</div>
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
			<div
				onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
				onDragLeave={() => setDragOver(false)}
				onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files); }}
				onClick={() => fileInputRef.current?.click()}
				className={`
					mt-4 border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
					${dragOver ? "border-cyan-400 bg-cyan-400/5" : "border-slate-700 hover:border-slate-500 bg-slate-900/50"}
					${uploading ? "opacity-50 pointer-events-none" : ""}
				`}
			>
				<input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => e.target.files && handleUpload(e.target.files)} />
				<div className="text-4xl mb-2">📤</div>
				<div className="text-sm text-slate-300 font-medium">{uploading ? "上传中..." : "拖拽图片到此处，或点击选择文件"}</div>
				<div className="text-xs text-slate-500 mt-1">支持 JPG / PNG / GIF / WebP / AVIF / SVG，单文件最大 20MB</div>
			</div>

			{/* Upload Progress */}
			{uploadProgress && (
				<div role="status" aria-label="图片上传进度" className="mt-3 rounded-xl border border-white/10 bg-slate-900/70 p-4 text-sm text-slate-300">
					<div className="flex items-center justify-between gap-3">
						<span>{uploading ? `正在上传第 ${uploadProgress.current}/${uploadProgress.total} 张` : `已完成 ${uploadProgress.success}/${uploadProgress.total} 张`}</span>
						<span className="text-xs text-slate-500">成功 {uploadProgress.success} · 失败 {uploadProgress.failure}</span>
					</div>
					<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
						<div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${Math.round(((uploadProgress.success + uploadProgress.failure) / Math.max(uploadProgress.total, 1)) * 100)}%` }} />
					</div>
					<div className="mt-3 space-y-1 text-xs">
						{uploadProgress.queue.map((item, index) => (
							<div key={`${item.name}-${index}`} className="flex items-center justify-between gap-3">
								<span className="truncate">{item.name} · {item.message}</span>
								<span className={item.status === "success" ? "text-emerald-300" : item.status === "error" || item.status === "skipped" ? "text-rose-300" : item.status === "uploading" ? "text-cyan-300" : "text-slate-500"}>
									{item.status === "success" ? "完成" : item.status === "error" || item.status === "skipped" ? "失败" : item.status === "uploading" ? "上传中" : "等待"}
								</span>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Album Filter */}
			<div className="mt-4 flex items-center gap-3">
				<input
					type="text"
					placeholder="按相册筛选（可选）"
					value={album}
					onChange={(e) => setAlbum(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && fetchImages(1)}
					className="bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/50 w-64"
				/>
				<button onClick={() => fetchImages(1)} className="px-4 py-2 text-sm bg-cyan-500/10 text-cyan-400 rounded-lg hover:bg-cyan-500/20 transition">搜索</button>
				<button onClick={() => { setAlbum(""); fetchImages(1); }} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition">重置</button>
			</div>

			{/* Image Grid */}
			{loading ? (
				<div className="mt-8 text-center text-slate-500">加载中...</div>
			) : images.length === 0 ? (
				<div className="mt-8 text-center text-slate-500 text-sm">暂无图片，上传第一张吧 🎉</div>
			) : (
				<div className="mt-6 grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
					{images.map((img) => (
						<Card key={img.id}>
							<div className="group relative aspect-square bg-slate-800/50 rounded-lg overflow-hidden mb-3">
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
									sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw"
									unoptimized
									className="object-cover cursor-pointer hover:scale-105 transition-transform duration-200"
									onClick={() => !batchMode && setPreviewImage(img)}
								/>
								{/* Hover overlay */}
								{!batchMode && (
									<div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
										<button onClick={() => copyLink(img.publicUrl)} className="px-2 py-1 text-xs bg-cyan-500/20 text-cyan-300 rounded hover:bg-cyan-500/30" title="复制外链">🔗</button>
										<button onClick={() => copyMarkdown(img)} className="px-2 py-1 text-xs bg-green-500/20 text-green-300 rounded hover:bg-green-500/30" title="复制 Markdown">M↓</button>
										<button onClick={() => copyHTML(img)} className="px-2 py-1 text-xs bg-orange-500/20 text-orange-300 rounded hover:bg-orange-500/30" title="复制 HTML">H</button>
										<button onClick={() => requestDelete(img)} className="px-2 py-1 text-xs bg-red-500/20 text-red-300 rounded hover:bg-red-500/30" title="删除">🗑</button>
									</div>
								)}
							</div>
							<div className="text-xs text-slate-300 truncate" title={img.filename}>{img.filename}</div>
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
					<button onClick={() => fetchImages(page - 1)} disabled={page <= 1} className="px-3 py-1.5 text-sm bg-slate-800 text-slate-300 rounded-lg disabled:opacity-30 hover:bg-slate-700 transition">上一页</button>
					<span className="text-sm text-slate-400">{page} / {totalPages}</span>
					<button onClick={() => fetchImages(page + 1)} disabled={page >= totalPages} className="px-3 py-1.5 text-sm bg-slate-800 text-slate-300 rounded-lg disabled:opacity-30 hover:bg-slate-700 transition">下一页</button>
				</div>
			)}

			{/* Preview Modal */}
			{previewImage && (
				<div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setPreviewImage(null)}>
					<div className="relative max-w-4xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
						<Image src={previewImage.publicUrl} alt={previewImage.filename} width={800} height={600} loading="lazy" unoptimized className="max-w-full max-h-[85vh] rounded-lg" />
						<div className="mt-3 flex items-center justify-between">
							<div>
								<div className="text-sm text-white font-medium">{previewImage.filename}</div>
								<div className="text-xs text-slate-400 mt-1">{formatSize(previewImage.sizeBytes)} · {previewImage.mimeType}</div>
							</div>
							<div className="flex gap-2">
								<button onClick={() => copyLink(previewImage.publicUrl)} className="px-3 py-1.5 text-xs bg-cyan-500/20 text-cyan-300 rounded-lg hover:bg-cyan-500/30">复制外链</button>
								<button onClick={() => copyMarkdown(previewImage)} className="px-3 py-1.5 text-xs bg-green-500/20 text-green-300 rounded-lg hover:bg-green-500/30">Markdown</button>
								<button onClick={() => copyHTML(previewImage)} className="px-3 py-1.5 text-xs bg-orange-500/20 text-orange-300 rounded-lg hover:bg-orange-500/30">HTML</button>
								<button onClick={() => requestDelete(previewImage)} className="px-3 py-1.5 text-xs bg-red-500/20 text-red-300 rounded-lg hover:bg-red-500/30">删除</button>
							</div>
						</div>
						<button onClick={() => setPreviewImage(null)} className="absolute -top-3 -right-3 w-8 h-8 bg-slate-800 text-slate-300 rounded-full flex items-center justify-center hover:bg-slate-700 text-lg">✕</button>
					</div>
				</div>
			)}

			{/* Publish from Storage Modal */}
			{showPublishModal && (
				<div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setShowPublishModal(false)}>
					<div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
						<h3 className="text-lg font-semibold text-white mb-4">☁️ 从云盘发布到图床</h3>
						<div className="space-y-3">
							<div>
								<label className="text-xs text-slate-400 mb-1 block">存储节点</label>
								<select value={publishForm.storageNodeId} onChange={(e) => setPublishForm({ ...publishForm, storageNodeId: e.target.value })} className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-400/50">
									<option value="">选择存储节点</option>
									{storageNodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
								</select>
							</div>
							<div>
								<label className="text-xs text-slate-400 mb-1 block">文件相对路径</label>
								<input type="text" value={publishForm.relativePath} onChange={(e) => setPublishForm({ ...publishForm, relativePath: e.target.value })} placeholder="e.g. images/photo.png" className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/50" />
							</div>
							<div>
								<label className="text-xs text-slate-400 mb-1 block">文件名（可选）</label>
								<input type="text" value={publishForm.filename} onChange={(e) => setPublishForm({ ...publishForm, filename: e.target.value })} placeholder="默认使用路径中的文件名" className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/50" />
							</div>
							<div>
								<label className="text-xs text-slate-400 mb-1 block">相册（可选）</label>
								<input type="text" value={publishForm.album} onChange={(e) => setPublishForm({ ...publishForm, album: e.target.value })} placeholder="归类到相册" className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/50" />
							</div>
						</div>
						<div className="mt-5 flex items-center justify-end gap-2">
							<button onClick={() => setShowPublishModal(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition">取消</button>
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
							<button type="button" onClick={() => setPendingDelete(null)} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition">取消</button>
							<button type="button" onClick={confirmDelete} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-500 transition">确认删除</button>
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

			<style jsx>{`
				@keyframes fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
				.animate-fade-in { animation: fade-in 0.2s ease-out; }
			`}</style>
		</PageShell>
	);
}
