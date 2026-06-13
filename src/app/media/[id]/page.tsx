import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, FolderOpen, Star, Tag } from "lucide-react";

import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getMediaItem, listMediaItems } from "@/lib/media/service";
import { PermissionDenied } from "@/components/page-shell";
import { MediaPreviewClient } from "@/app/files/preview/media-preview-client";
import {
  buildSearchHref,
  toStorageEntry,
  type FileProp,
} from "@/app/files/file-entry-utils";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ from?: string }>;
};

type MediaPlayerItem = NonNullable<Awaited<ReturnType<typeof getMediaItem>>>;

function formatSize(bytes: bigint | number | null) {
  if (!bytes) return "未知";
  const b = Number(bytes);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function containingFolderPath(relativePath: string) {
  const segments = relativePath.split("/").filter(Boolean);
  segments.pop();
  return segments.join("/");
}

function safeMediaReturnHref(from?: string) {
  if (!from) return "/media";
  try {
    const decoded = decodeURIComponent(from);
    if (decoded === "/media" || decoded.startsWith("/media?")) return decoded;
  } catch {
    // Fall through to default route when the return URL is malformed.
  }
  return "/media";
}

function createStorageEntry(item: MediaPlayerItem) {
  const node = item.storageNode;
  if (!node) return null;

  const directAccessMode = String(node.directAccessMode ?? "PROXY");
  const isDirectAccess =
    directAccessMode === "DIRECT" || directAccessMode === "direct-url";
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

export default async function MediaPlayerPage({
  params,
  searchParams,
}: PageProps) {
  const session = await requireSession("/media");
  if (!sessionHasPermission(session, "storage:read"))
    return <PermissionDenied />;

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const item = await getMediaItem(id);
  if (!item) notFound();

  const siblings = await listMediaItems({
    mediaType: item.mediaType as "image" | "video" | "audio",
  });
  const currentIndex = siblings.findIndex((entry) => entry.id === item.id);
  const previousItem = currentIndex > 0 ? siblings[currentIndex - 1] : null;
  const nextItem =
    currentIndex >= 0 && currentIndex < siblings.length - 1
      ? siblings[currentIndex + 1]
      : null;

  const storageEntry = createStorageEntry(item);
  if (!storageEntry) notFound();

  const mediaHref = `/api/media/${encodeURIComponent(item.id)}/stream`;
  const downloadHref = `${mediaHref}?download=1`;
  const sourceHref = buildSearchHref(containingFolderPath(item.relativePath), {
    nodeId: item.storageNode?.id ?? "",
    q: item.name,
  });
  const returnHref = safeMediaReturnHref(query?.from);
  const navigationFrom = encodeURIComponent(returnHref);
  const isImage =
    item.mimeType.startsWith("image/") && item.mimeType !== "image/svg+xml";
  const isVideo = item.mimeType.startsWith("video/");
  const isAudio = item.mimeType.startsWith("audio/");
  const mediaKindLabel =
    item.mediaType === "image"
      ? "图片"
      : item.mediaType === "audio"
        ? "音频"
        : "视频";

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-6">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Link
              href={returnHref}
              className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 hover:border-cyan-400/50 hover:bg-white/5 light:hover:bg-white"
            >
              ← 返回媒体库
            </Link>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">
                Media Player
              </p>
              <h1 className="truncate text-xl font-semibold text-white">
                {item.name}
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <a
              href={downloadHref}
              data-tone="accent"
              className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2"
            >
              <Download size={16} /> 下载
            </a>
            <Link
              href={sourceHref}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-4 py-2 text-slate-200 hover:bg-white/5 light:hover:bg-white"
            >
              <FolderOpen size={16} /> 打开源文件
            </Link>
          </div>
        </header>

        <section className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            <div className="flex min-h-[55vh] items-center justify-center rounded-3xl border border-white/10 bg-slate-950/70 p-4">
              {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaHref}
                  alt={item.name}
                  className="max-h-[78vh] max-w-full rounded-2xl object-contain"
                />
              ) : isVideo || isAudio ? (
                <MediaPreviewClient
                  href={mediaHref}
                  name={item.name}
                  mimeType={item.mimeType}
                  driver={item.storageNode?.driver ?? "LOCAL"}
                  nodeId={item.storageNode?.id ?? ""}
                  relativePath={item.relativePath}
                />
              ) : (
                <div className="py-16 text-center text-sm text-[var(--text-secondary)]">
                  此媒体类型暂不支持在线预览，请下载后查看。
                </div>
              )}
            </div>
            <nav
              aria-label="媒体播放导航"
              className="grid gap-2 sm:grid-cols-2"
            >
              {previousItem ? (
                <Link
                  href={`/media/${encodeURIComponent(previousItem.id)}?from=${navigationFrom}`}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-200 transition hover:bg-white/[0.06]"
                >
                  <span className="block text-xs text-slate-500">上一项</span>
                  <span className="mt-1 block truncate font-medium">
                    {previousItem.name}
                  </span>
                </Link>
              ) : (
                <span className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-500">
                  已经是第一项
                </span>
              )}
              {nextItem ? (
                <Link
                  href={`/media/${encodeURIComponent(nextItem.id)}?from=${navigationFrom}`}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-right text-sm text-slate-200 transition hover:bg-white/[0.06]"
                >
                  <span className="block text-xs text-slate-500">下一项</span>
                  <span className="mt-1 block truncate font-medium">
                    {nextItem.name}
                  </span>
                </Link>
              ) : (
                <span className="rounded-2xl border border-white/10 px-4 py-3 text-right text-sm text-slate-500">
                  已经是最后一项
                </span>
              )}
            </nav>
          </div>

          <aside className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 light:bg-slate-50">
            <div className="mb-4 flex items-center gap-2">
              <span className="text-3xl">
                {item.mediaType === "image"
                  ? "🖼"
                  : item.mediaType === "audio"
                    ? "🎵"
                    : "🎬"}
              </span>
              <div>
                <p className="text-sm font-medium text-white">
                  {mediaKindLabel}
                </p>
                <p className="text-xs text-slate-500">
                  {item.mimeType || "未知 MIME"}
                </p>
              </div>
              {item.favorite ? (
                <Star
                  className="ml-auto text-amber-400"
                  size={18}
                  fill="currentColor"
                />
              ) : null}
            </div>

            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">
                  大小
                </dt>
                <dd className="mt-1 text-slate-200">
                  {formatSize(item.size)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">
                  存储
                </dt>
                <dd className="mt-1 text-slate-200">
                  {item.storageNode?.server?.name ??
                    item.storageNode?.name ??
                    "未知存储"}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">
                  路径
                </dt>
                <dd className="mt-1 break-all rounded-2xl bg-black/20 p-3 font-mono text-xs text-slate-300">
                  {item.relativePath}
                </dd>
              </div>
            </dl>

            {item.tags.length > 0 ? (
              <div className="mt-5">
                <div className="mb-2 inline-flex items-center gap-1 text-xs uppercase tracking-wide text-slate-500">
                  <Tag size={12} /> 标签
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {item.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-cyan-400/10 px-2.5 py-1 text-xs text-cyan-300"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>
        </section>
      </div>
    </main>
  );
}
