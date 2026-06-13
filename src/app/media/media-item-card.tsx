"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Download, Eye, FolderOpen, ImageIcon, Link as LinkIcon, Music2, Star, Tag, Video } from "lucide-react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import {
	appendDownloadFlag,
	buildProxyDownloadHref,
	buildSearchHref,
	toStorageEntry,
	type FileProp,
} from "@/app/files/file-entry-utils";

export interface MediaItem {
	id: string;
	name: string;
	relativePath: string;
	mediaType: string;
	size: bigint | number | null;
	favorite: boolean;
	tags: string[];
	mimeType: string;
	storageNode?: {
		id: string;
		name: string;
		basePath: string;
		driver: string;
		directAccessMode?: string | null;
		publicBaseUrl?: string | null;
		server?: { name: string } | null;
	} | null;
}

function formatSize(bytes: bigint | number | null) {
	if (!bytes) return "未知";
	const b = Number(bytes);
	if (b < 1024) return `${b} B`;
	if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
	if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
	return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function storageLabel(m: MediaItem) {
	const node = m.storageNode;
	if (!node) return "未知存储";
	const serverName = node.server?.name ?? "本地";
	return `${serverName} · ${node.basePath}`;
}

function createStorageEntry(item: MediaItem) {
	const node = item.storageNode;
	if (!node) return null;

	const rawMode = String(node.directAccessMode ?? "PROXY");
	const isDirectAccess = rawMode === "DIRECT" || rawMode === "direct-url";

	const file: FileProp = {
		id: item.id,
		name: item.name,
		entryType: "FILE",
		mimeType: item.mimeType,
		relativePath: item.relativePath,
		sizeBytes: item.size == null ? null : Number(item.size),
		sizeLabel: formatSize(item.size),
		previewable: true,
		directAccessMode: isDirectAccess ? "direct-url" : "managed-download",
		directAccessHref:
			isDirectAccess && node.publicBaseUrl
				? `${node.publicBaseUrl.replace(/\/$/, "")}/${item.relativePath
						.split("/")
						.map(encodeURIComponent)
						.join("/")}`
				: null,
		directAccessDescription: isDirectAccess ? "目标服务器直连" : "网站中转",
		storageNodeId: node.id,
		storageNodeName: node.name,
		storageNodeDriver: node.driver,
		updatedAt: null,
	};
	return toStorageEntry(file);
}

function containingFolderPath(relativePath: string) {
	const segments = relativePath.split("/").filter(Boolean);
	segments.pop();
	return segments.join("/");
}

function getErrorMessage(error: unknown, fallback: string) {
	return error instanceof Error && error.message ? error.message : fallback;
}

function mediaTypeLabel(mediaType: string) {
	if (mediaType === "image") return "图片";
	if (mediaType === "video") return "视频";
	if (mediaType === "audio") return "音频";
	return "媒体";
}

function MediaCover({ item, sourceHref }: { item: MediaItem; sourceHref: string | null }) {
	const fileHref = `/api/media/${encodeURIComponent(item.id)}/stream`;
	const coverClass = "absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105";
	const typeBadge = (
		<span className="absolute left-2 top-2 z-10 rounded-full border border-black/10 bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur light:border-white/30">
			{mediaTypeLabel(item.mediaType)}
		</span>
	);
	const icon = item.mediaType === "audio" ? <Music2 size={32} /> : item.mediaType === "video" ? <Video size={32} /> : <ImageIcon size={32} />;

	const fallback = (
		<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.24),transparent_45%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(30,41,59,0.88))] text-slate-200 light:bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.18),transparent_45%),linear-gradient(135deg,#e2e8f0,#f8fafc)]">
			<div className="rounded-2xl border border-white/10 bg-white/10 p-3 shadow-inner light:bg-white/80">{icon}</div>
			<span className="text-xs font-medium">{mediaTypeLabel(item.mediaType)}预览</span>
		</div>
	);

	const visual = item.mediaType === "image" && fileHref ? (
		<Image src={fileHref} alt={`${item.name} 缩略图`} fill sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw" unoptimized className={coverClass} />
	) : item.mediaType === "video" && fileHref ? (
		<video src={`${fileHref}#t=0.1`} preload="metadata" muted playsInline className={coverClass} aria-label={`${item.name} 视频封面`} />
	) : fallback;

	return (
		<a href={sourceHref ?? fileHref ?? "#"} className="relative block aspect-[4/3] overflow-hidden rounded-xl border border-white/[0.06] bg-slate-950/60" aria-label={`${item.name} ${mediaTypeLabel(item.mediaType)}预览`}>
			{visual}
			{typeBadge}
			{item.mediaType !== "audio" && (
				<div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
			)}
			<div className="absolute bottom-2 right-2 rounded-full border border-white/15 bg-black/50 px-2 py-0.5 text-[10px] text-white backdrop-blur">
				{formatSize(item.size)}
			</div>
		</a>
	);
}

export function MediaItemCard({ item, canManage }: { item: MediaItem; canManage: boolean }) {
	const [fav, setFav] = useState(item.favorite);
	const [tags, setTags] = useState(item.tags || []);
	const [showTagInput, setShowTagInput] = useState(false);
	const [newTag, setNewTag] = useState("");
	const [imageBedUrl, setImageBedUrl] = useState<string | null>(null);
	const [publishError, setPublishError] = useState<string | null>(null);
	const [publishing, setPublishing] = useState(false);

	const toggleFav = async () => {
		const next = !fav;
		setFav(next);
		try {
			await csrfFetch(`/api/media/${item.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ favorite: next }),
			});
		} catch {
			setFav(!next);
		}
	};

	const addTag = async () => {
		const tag = newTag.trim();
		if (!tag || tags.includes(tag)) return;
		const next = [...tags, tag];
		setTags(next);
		setNewTag("");
		setShowTagInput(false);
		try {
			await csrfFetch(`/api/media/${item.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ tags: next }),
			});
		} catch {
			setTags(tags);
		}
	};

	const removeTag = async (t: string) => {
		const next = tags.filter((x) => x !== t);
		setTags(next);
		try {
			await csrfFetch(`/api/media/${item.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ tags: next }),
			});
		} catch {
			setTags(tags);
		}
	};

	const publishAsImageBed = async () => {
		if (!item.storageNode || item.mediaType !== "image") return;
		setPublishing(true);
		setPublishError(null);
		try {
			const result = await csrfFetch<{ publicUrl?: string }>("/api/images/publish-from-storage", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					storageNodeId: item.storageNode.id,
					relativePath: item.relativePath,
					filename: item.name,
				}),
			});
			const publicUrl = result.publicUrl ?? "";
			const absoluteUrl = publicUrl.startsWith("http") ? publicUrl : `${window.location.origin}${publicUrl}`;
			setImageBedUrl(absoluteUrl);
			await navigator.clipboard?.writeText(absoluteUrl).catch(() => undefined);
		} catch (error) {
			setPublishError(getErrorMessage(error, "发布图床外链失败"));
		} finally {
			setPublishing(false);
		}
	};

	const storageEntry = createStorageEntry(item);
	const previewHref = storageEntry
		? `/media/${encodeURIComponent(item.id)}?from=${encodeURIComponent("/media")}`
		: null;
	const downloadHref = storageEntry ? appendDownloadFlag(buildProxyDownloadHref(storageEntry)) : null;
	const sourceHref = item.storageNode
		? buildSearchHref(containingFolderPath(item.relativePath), {
				nodeId: item.storageNode.id,
				q: item.name,
			})
		: null;

	return (
		<div className="group overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3 transition hover:-translate-y-0.5 hover:border-cyan-300/25 hover:bg-white/[0.045] light:shadow-sm light:hover:border-cyan-200 light:hover:shadow-md">
			<MediaCover item={item} sourceHref={previewHref} />

			<div className="mt-3 flex items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<span>{item.mediaType === "image" ? "🖼" : item.mediaType === "audio" ? "🎵" : "🎬"}</span>
						<span className="truncate text-sm font-medium text-white">{item.name}</span>
					</div>
					<p className="mt-1 truncate text-[11px] text-slate-500" title={item.relativePath}>📂 {item.relativePath}</p>
					<div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[10px] text-slate-500">
						<span>💾 {storageLabel(item)}</span>
					</div>
				</div>
				{canManage && (
					<button
						type="button"
						onClick={toggleFav}
						className={`shrink-0 rounded p-1 transition ${fav ? "text-amber-400 hover:text-amber-300" : "text-slate-600 hover:text-amber-400 opacity-0 group-hover:opacity-100"}`}
						title={fav ? "取消收藏" : "收藏"}
					>
						<Star size={16} fill={fav ? "currentColor" : "none"} />
					</button>
				)}
				{!canManage && fav && <span className="text-amber-400 text-sm">⭐</span>}
			</div>

			<div className="mt-3 flex flex-wrap gap-2 text-xs">
				{previewHref ? (
					<a href={previewHref} className="inline-flex items-center gap-1 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-1.5 text-cyan-200 hover:bg-cyan-400/20">
						<Eye size={13} /> 预览/播放
					</a>
				) : null}
				{downloadHref ? (
					<a href={downloadHref} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-slate-300 hover:bg-white/10 light:hover:bg-white">
						<Download size={13} /> 下载
					</a>
				) : null}
				{sourceHref ? (
					<a href={sourceHref} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-slate-300 hover:bg-white/10 light:hover:bg-white">
						<FolderOpen size={13} /> 源文件
					</a>
				) : null}
				{canManage && item.mediaType === "image" && item.storageNode ? (
					<button
						type="button"
						onClick={() => void publishAsImageBed()}
						disabled={publishing}
						className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1.5 text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-50"
						title="把这张已存储图片发布为图床外链，并复制外链"
					>
						<LinkIcon size={13} /> {publishing ? "发布中" : "图床外链"}
					</button>
				) : null}
			</div>

			{imageBedUrl ? (
				<div className="mt-2 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2 py-1.5 text-[11px] text-emerald-100">
					外链已生成并尝试复制：<a href={imageBedUrl} target="_blank" rel="noreferrer" className="break-all underline">{imageBedUrl}</a>
				</div>
			) : null}
			{publishError ? <p role="alert" className="mt-2 text-[11px] text-rose-300">{publishError}</p> : null}

			{canManage && (
				<div className="mt-2 flex flex-wrap items-center gap-1">
					{tags.map((t) => (
						<span key={t} className="inline-flex items-center gap-1 rounded-full bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-300">
							<Link href={`/media?tag=${encodeURIComponent(t)}`} className="hover:underline">#{t}</Link>
							<button type="button" onClick={() => removeTag(t)} className="text-cyan-400/50 hover:text-cyan-300 light:hover:text-cyan-700">×</button>
						</span>
					))}
					{showTagInput ? (
						<input
							autoFocus
							value={newTag}
							onChange={(e) => setNewTag(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") void addTag();
								if (e.key === "Escape") setShowTagInput(false);
							}}
							onBlur={() => {
								if (newTag.trim()) void addTag();
								else setShowTagInput(false);
							}}
							className="w-20 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white outline-none placeholder:text-slate-600 light:placeholder:text-slate-500"
							placeholder="标签名"
						/>
					) : (
						<button
							type="button"
							onClick={() => setShowTagInput(true)}
							className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-[var(--border)] px-2 py-0.5 text-[10px] text-slate-500 opacity-0 transition group-hover:opacity-100 hover:border-cyan-400/30 hover:text-cyan-400"
						>
							<Tag size={10} /> 添加
						</button>
					)}
				</div>
			)}

			{!canManage && tags.length > 0 && (
				<div className="mt-2 flex flex-wrap items-center gap-1">
					{tags.map((t) => (
						<Link key={t} href={`/media?tag=${encodeURIComponent(t)}`} className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-300 hover:underline">#{t}</Link>
					))}
				</div>
			)}
		</div>
	);
}
