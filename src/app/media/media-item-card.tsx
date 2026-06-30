"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Download, Eye, FolderOpen, ImageIcon, LinkIcon, Music2, Star, Tag, Video } from "@/components/icons";

import { csrfFetch } from "@/lib/auth/csrf-client";
import {
	appendDownloadFlag,
	buildProxyDownloadHref,
	buildSearchHref,
	toStorageEntry,
	type FileProp,
} from "@/app/files/file-entry-utils";
import { useI18n } from "@/lib/i18n/use-locale";

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

function formatSize(bytes: bigint | number | null, t: (k: string) => string) {
	if (!bytes) return t("mediaItemCard.unknown");
	const b = Number(bytes);
	if (b < 1024) return `${b} B`;
	if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
	if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
	return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function storageLabel(m: MediaItem, t: (k: string) => string) {
	const node = m.storageNode;
	if (!node) return t("mediaItemCard.unknownStorage");
	const serverName = node.server?.name ?? t("mediaItemCard.localServer");
	return `${serverName} · ${node.basePath}`;
}

function createStorageEntry(item: MediaItem, t: (k: string) => string) {
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
		sizeLabel: formatSize(item.size, t),
		previewable: true,
		directAccessMode: isDirectAccess ? "direct-url" : "managed-download",
		directAccessHref:
			isDirectAccess && node.publicBaseUrl
				? `${node.publicBaseUrl.replace(/\/$/, "")}/${item.relativePath
						.split("/")
						.map(encodeURIComponent)
						.join("/")}`
				: null,
		directAccessDescription: isDirectAccess ? t("mediaItemCard.directAccess") : t("mediaItemCard.managedDownload"),
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

function mediaTypeLabel(mediaType: string, t: (k: string) => string) {
	if (mediaType === "image") return t("mediaItemCard.type.image");
	if (mediaType === "video") return t("mediaItemCard.type.video");
	if (mediaType === "audio") return t("mediaItemCard.type.audio");
	return t("mediaItemCard.type.other");
}

function MediaCover({ item, sourceHref, t }: { item: MediaItem; sourceHref: string | null; t: (k: string) => string }) {
	const fileHref = `/api/media/${encodeURIComponent(item.id)}/stream`;
	const thumbHref = `/api/media/${encodeURIComponent(item.id)}/thumbnail`;
	const coverClass = "absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105";
	const typeBadge = (
		<span className="absolute left-2 top-2 z-10 rounded-full border border-black/10 bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur light:border-white/30">
			{mediaTypeLabel(item.mediaType, t)}
		</span>
	);
	const icon = item.mediaType === "audio" ? <Music2 size={32} /> : item.mediaType === "video" ? <Video size={32} /> : <ImageIcon size={32} />;

	const fallback = (
		<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.24),transparent_45%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(30,41,59,0.88))] text-slate-200 light:bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.18),transparent_45%),linear-gradient(135deg,#e2e8f0,#f8fafc)]">
			<div className="rounded-2xl border border-white/10 bg-white/10 p-3 shadow-inner">{icon}</div>
			<span className="text-xs font-medium">{mediaTypeLabel(item.mediaType, t)}{t("mediaItemCard.typePreview")}</span>
		</div>
	);

	const visual = item.mediaType === "image" && fileHref ? (
		<Image src={thumbHref} alt={t("mediaItemCard.thumbnailAlt").replace("{name}", item.name)} fill sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw" unoptimized className={coverClass} />
	) : item.mediaType === "video" && fileHref ? (
		<video src={`${fileHref}#t=0.1`} preload="metadata" muted playsInline className={coverClass} aria-label={t("mediaItemCard.videoCover").replace("{name}", item.name)} />
	) : fallback;

	return (
		<a href={sourceHref ?? fileHref ?? "#"} className="relative block aspect-[4/3] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)]" aria-label={t("mediaItemCard.previewAriaLabel").replace("{name}", item.name).replace("{type}", mediaTypeLabel(item.mediaType, t))}>
			{visual}
			{typeBadge}
			{item.mediaType !== "audio" && (
				<div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
			)}
			<div className="absolute bottom-2 right-2 rounded-full border border-white/10 bg-black/50 px-2 py-0.5 text-[10px] text-white backdrop-blur">
				{formatSize(item.size, t)}
			</div>
		</a>
	);
}

export function MediaItemCard({ item, canManage }: { item: MediaItem; canManage: boolean }) {
	const { t } = useI18n();
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

	const removeTag = async (tag: string) => {
		const next = tags.filter((x) => x !== tag);
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
			setPublishError(getErrorMessage(error, t("mediaItemCard.publishErrorFallback")));
		} finally {
			setPublishing(false);
		}
	};

	const storageEntry = createStorageEntry(item, t);
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
			<MediaCover item={item} sourceHref={previewHref} t={t} />

			<div className="mt-3 flex items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<span>{item.mediaType === "image" ? "🖼" : item.mediaType === "audio" ? "🎵" : "🎬"}</span>
						<span className="truncate text-sm font-medium text-white" title={item.name}>{item.name}</span>
					</div>
					<p className="mt-1 truncate text-[11px] text-slate-500" title={item.relativePath}>📂 {item.relativePath}</p>
					<div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[10px] text-slate-500">
						<span>💾 {storageLabel(item, t)}</span>
					</div>
				</div>
				{canManage && (
					<button
						type="button"
						onClick={toggleFav}
						className={`shrink-0 rounded p-1 transition ${fav ? "text-amber-400 hover:text-amber-300" : "text-[var(--text-muted)] hover:text-amber-400 opacity-0 group-hover:opacity-100"}`}
						title={fav ? t("mediaItemCard.favoriteRemove") : t("mediaItemCard.favoriteAdd")}
					>
						<Star size={16} fill={fav ? "currentColor" : "none"} />
					</button>
				)}
				{!canManage && fav && <span className="text-amber-400 text-sm">⭐</span>}
			</div>

			<div className="mt-3 flex flex-wrap gap-2 text-xs">
				{previewHref ? (
					<a href={previewHref} data-tone="cyan" className="inline-flex items-center gap-1 rounded-lg border border-cyan-400/25 px-2.5 py-1.5 text-cyan-200 hover:bg-cyan-400/20">
						<Eye size={13} /> {t("mediaItemCard.previewButton")}
					</a>
				) : null}
				{downloadHref ? (
					<a href={downloadHref} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-slate-300 hover:bg-white/10 light:hover:bg-white">
						<Download size={13} /> {t("mediaItemCard.downloadButton")}
					</a>
				) : null}
				{sourceHref ? (
					<a href={sourceHref} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-slate-300 hover:bg-white/10 light:hover:bg-white">
						<FolderOpen size={13} /> {t("mediaItemCard.sourceFileButton")}
					</a>
				) : null}
				{canManage && item.mediaType === "image" && item.storageNode ? (
					<button
						type="button"
						onClick={() => void publishAsImageBed()}
						disabled={publishing}
						data-tone="emerald" className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/25 px-2.5 py-1.5 text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-50"
						title={t("mediaItemCard.publishTooltip")}
					>
						<LinkIcon size={13} /> {publishing ? t("mediaItemCard.publishing") : t("mediaItemCard.publishToImageBed")}
					</button>
				) : null}
			</div>

			{imageBedUrl ? (
				<div data-tone="emerald" className="mt-2 rounded-lg border border-emerald-400/20 px-2 py-1.5 text-[11px] text-emerald-100">
					{t("mediaItemCard.imageBedUrlGenerated")}：<a href={imageBedUrl} target="_blank" rel="noreferrer" className="break-all underline">{imageBedUrl}</a>
				</div>
			) : null}
			{publishError ? <p role="alert" className="mt-2 text-[11px] text-rose-300">{publishError}</p> : null}

			{canManage && (
				<div className="mt-2 flex flex-wrap items-center gap-1">
					{tags.map((tag) => (
						<span key={tag} data-tone="cyan" className="inline-flex items-center gap-1 rounded-full border border-[var(--accent-border)] px-2 py-0.5 text-[10px] text-[var(--accent)]">
							<Link href={`/media?tag=${encodeURIComponent(tag)}`} className="hover:underline">#{tag}</Link>
							<button type="button" onClick={() => removeTag(tag)} className="text-[var(--text-muted)] hover:text-[var(--accent)]">×</button>
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
							aria-label={t("mediaItemCard.newTagAriaLabel")}
							className="w-20 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white outline-none placeholder:text-[var(--text-muted)]"
							placeholder={t("mediaItemCard.newTagPlaceholder")}
						/>
					) : (
						<button
							type="button"
							onClick={() => setShowTagInput(true)}
							className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-[var(--border)] px-2 py-0.5 text-[10px] text-slate-500 opacity-0 transition group-hover:opacity-100 hover:border-cyan-400/30 hover:text-cyan-400"
						>
							<Tag size={10} /> {t("mediaItemCard.addTag")}
						</button>
					)}
				</div>
			)}

			{!canManage && tags.length > 0 && (
				<div className="mt-2 flex flex-wrap items-center gap-1">
					{tags.map((tag) => (
						<Link key={tag} href={`/media?tag=${encodeURIComponent(tag)}`} data-tone="cyan" className="rounded-full border border-[var(--accent-border)] px-2 py-0.5 text-[10px] text-[var(--accent)] hover:underline">#{tag}</Link>
					))}
				</div>
			)}
		</div>
	);
}
