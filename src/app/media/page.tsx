import Link from "next/link";

import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listMediaItems, listMediaTags } from "@/lib/media/service";
import { PageShell, PermissionDenied } from "@/components/page-shell";
import { MediaScanButton } from "./media-scan-button";
import { MediaItemCard } from "./media-item-card";

export const dynamic = "force-dynamic";

type MediaSearchParams = { type?: string; q?: string; favorite?: string; tag?: string };

function mediaHref(input: { type?: string; favorite?: boolean; q?: string; tag?: string }) {
  const params = new URLSearchParams();
  if (input.type) params.set("type", input.type);
  if (input.favorite) params.set("favorite", "1");
  if (input.q) params.set("q", input.q);
  if (input.tag) params.set("tag", input.tag);
  const query = params.toString();
  return query ? `/media?${query}` : "/media";
}

export default async function Page({ searchParams }: { searchParams?: Promise<MediaSearchParams> }) {
  const session = await requireSession("/media");
  if (!sessionHasPermission(session, "storage:read")) return <PermissionDenied />;
  const canManageMedia = sessionHasPermission(session, "media:manage");
  const params = await searchParams;
  const mediaType = params?.type === "image" || params?.type === "video" || params?.type === "audio"
    ? (params.type as "image" | "video" | "audio")
    : undefined;
  const favorite = params?.favorite === "1" ? true : undefined;
  const q = params?.q?.trim() || undefined;
  const tag = params?.tag?.trim() || undefined;
  const [media, tagCloud] = await Promise.all([
    listMediaItems({ mediaType, q, favorite, tag }),
    listMediaTags(),
  ]);

  const grouped = new Map<string, typeof media>();
  for (const m of media) {
    const groupKey = m.storageNode?.server?.name ?? m.storageNode?.name ?? "未分配存储";
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey)!.push(m);
  }

  const imageCount = media.filter((m) => m.mediaType === "image").length;
  const videoCount = media.filter((m) => m.mediaType === "video").length;
  const audioCount = media.filter((m) => m.mediaType === "audio").length;
  const favCount = media.filter((m) => m.favorite).length;

  return (
    <PageShell>
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300 light:text-cyan-700/70">Media</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white light:text-slate-900">媒体库</h1>
        <p className="mt-1.5 text-sm text-slate-500">聚合文件管理中的图片、视频和音频，按服务器分组在线浏览/播放。收藏和标签可直接筛选。</p>
      </header>

      <form method="GET" action="/media" className="mb-4 flex flex-wrap items-center gap-2">
        {mediaType && <input type="hidden" name="type" value={mediaType} />}
        {favorite && <input type="hidden" name="favorite" value="1" />}
        {tag && <input type="hidden" name="tag" value={tag} />}
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="搜索文件名、路径、标签…"
          className="w-full max-w-sm rounded-lg border border-white/10 light:border-slate-200 bg-white/[0.04] px-3 py-2 text-sm text-white light:text-slate-900 outline-none focus:border-cyan-400/50 placeholder:text-slate-600 light:placeholder:text-slate-500"
        />
        <button type="submit" className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white light:text-slate-900 transition hover:bg-cyan-500">搜索</button>
        {(q || tag || mediaType || favorite) && (
          <Link href="/media" className="rounded-lg border border-white/10 light:border-slate-200 px-3 py-2 text-sm text-slate-400 light:text-slate-600 transition hover:bg-white/5">清除筛选</Link>
        )}
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <Link href="/media" className={`rounded-full border px-3 py-1 transition ${!mediaType && !favorite && !tag ? "border-cyan-400/40 bg-cyan-400/20 text-cyan-100 light:text-cyan-900" : "border-cyan-400/20 bg-cyan-400/[0.06] text-cyan-200 light:text-cyan-800 hover:bg-cyan-400/10"}`}>当前 {media.length} 项</Link>
        <Link href={mediaHref({ type: "image", favorite, q, tag })} className={`rounded-full border px-3 py-1 transition ${mediaType === "image" ? "border-blue-400/40 bg-blue-400/20 text-blue-100 light:text-blue-900" : "border-blue-400/20 bg-blue-400/[0.06] text-blue-200 light:text-blue-800 hover:bg-blue-400/10"}`}>图片 {imageCount}</Link>
        <Link href={mediaHref({ type: "video", favorite, q, tag })} className={`rounded-full border px-3 py-1 transition ${mediaType === "video" ? "border-purple-400/40 bg-purple-400/20 text-purple-100 light:text-purple-900" : "border-purple-400/20 bg-purple-400/[0.06] text-purple-200 light:text-purple-800 hover:bg-purple-400/10"}`}>视频 {videoCount}</Link>
        <Link href={mediaHref({ type: "audio", favorite, q, tag })} className={`rounded-full border px-3 py-1 transition ${mediaType === "audio" ? "border-emerald-400/40 bg-emerald-400/20 text-emerald-100 light:text-emerald-900" : "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200 light:text-emerald-800 hover:bg-emerald-400/10"}`}>音频 {audioCount}</Link>
        <Link href={mediaHref({ type: mediaType, favorite: true, q, tag })} className={`rounded-full border px-3 py-1 transition ${favorite ? "border-amber-400/40 bg-amber-400/20 text-amber-100 light:text-amber-900" : "border-amber-400/20 bg-amber-400/[0.06] text-amber-200 light:text-amber-800 hover:bg-amber-400/10"}`}>⭐ 收藏 {favCount}</Link>
      </div>

      {tagCloud.length > 0 && (
        <div className="mb-5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 light:border-slate-200 light:bg-slate-50">
          <div className="mb-2 text-xs font-semibold text-slate-400 light:text-slate-600">标签筛选</div>
          <div className="flex flex-wrap gap-2 text-xs">
            {tagCloud.map((entry) => (
              <Link
                key={entry.tag}
                href={mediaHref({ type: mediaType, favorite, q, tag: entry.tag })}
                className={`rounded-full border px-2.5 py-1 transition ${tag === entry.tag ? "border-cyan-400/40 bg-cyan-400/20 text-cyan-100 light:text-cyan-900" : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06] light:border-slate-200 light:bg-white light:text-slate-700"}`}
              >
                #{entry.tag} <span className="opacity-60">{entry.count}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {canManageMedia && <MediaScanButton />}

      {grouped.size === 0 && (
        <div className="mt-6 rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center text-sm text-slate-400 light:text-slate-600">
          暂无媒体条目。请先在文件管理中浏览 VPS 存储，然后点击「扫描媒体索引」生成媒体列表。
        </div>
      )}

      {Array.from(grouped.entries()).map(([serverName, items]) => (
        <section key={serverName} className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-lg">🖥️</span>
            <h2 className="text-sm font-semibold text-white light:text-slate-900">{serverName}</h2>
            <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] text-slate-400 light:text-slate-600">{items.length} 项</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((m) => (
              <MediaItemCard key={m.id} item={m as unknown as import("./media-item-card").MediaItem} canManage={canManageMedia} />
            ))}
          </div>
        </section>
      ))}
    </PageShell>
  );
}
