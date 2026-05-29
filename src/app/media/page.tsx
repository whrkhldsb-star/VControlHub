import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listMediaItems } from "@/lib/media/service";
import { PageShell, Card, PermissionDenied } from "@/components/page-shell";
import { MediaScanButton } from "./media-scan-button";

export const dynamic = "force-dynamic";

function formatSize(bytes: bigint | number | null) {
  if (!bytes) return "未知";
  const b = Number(bytes);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function storageLocationLabel(m: { storageNode?: { name: string; basePath: string; server?: { name: string } | null } | null }) {
  const node = m.storageNode;
  if (!node) return "未知存储";
  const serverName = node.server?.name ?? "本地";
  return `${serverName} · ${node.basePath}`;
}

export default async function Page({ searchParams }: { searchParams?: Promise<{ type?: string; q?: string }> }) {
  const session = await requireSession("/media");
  if (!sessionHasPermission(session, "storage:read")) return <PermissionDenied />;
  const canManageMedia = sessionHasPermission(session, "media:manage");
  const params = await searchParams;
  const mediaType = params?.type === "image" || params?.type === "video" ? (params.type as "image" | "video") : undefined;
  const q = params?.q || undefined;
  const media = await listMediaItems({ mediaType, q });

  // Group by storage node server name
  const grouped = new Map<string, typeof media>();
  for (const m of media) {
    const groupKey = m.storageNode?.server?.name ?? m.storageNode?.name ?? "未分配存储";
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey)!.push(m);
  }

  const imageCount = media.filter((m) => m.mediaType === "image").length;
  const videoCount = media.filter((m) => m.mediaType === "video").length;

  return (
    <PageShell>
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300/70">Media</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">媒体库</h1>
        <p className="mt-1.5 text-sm text-slate-500">聚合各 VPS 云盘中的图片和视频，按服务器分组显示。支持收藏和标签。</p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-cyan-400/20 bg-cyan-400/[0.06] px-3 py-1 text-cyan-200">共 {media.length} 项</span>
        <span className="rounded-full border border-blue-400/20 bg-blue-400/[0.06] px-3 py-1 text-blue-200">图片 {imageCount}</span>
        <span className="rounded-full border border-purple-400/20 bg-purple-400/[0.06] px-3 py-1 text-purple-200">视频 {videoCount}</span>
      </div>

      {canManageMedia && <MediaScanButton />}

      {grouped.size === 0 && (
        <div className="mt-6 rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center text-sm text-slate-400">
          暂无媒体条目。请先在文件管理中浏览 VPS 存储，然后点击「扫描媒体索引」生成媒体列表。
        </div>
      )}

      {Array.from(grouped.entries()).map(([serverName, items]) => (
        <section key={serverName} className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-lg">🖥️</span>
            <h2 className="text-sm font-semibold text-white">{serverName}</h2>
            <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] text-slate-400">{items.length} 项</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((m) => (
              <Card key={m.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span>{m.mediaType === "image" ? "🖼" : "🎬"}</span>
                      <span className="truncate text-sm font-medium text-white">{m.name}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500" title={m.relativePath}>📂 {m.relativePath}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[10px] text-slate-500">
                      <span>📦 {formatSize(m.size)}</span>
                      <span>💾 {storageLocationLabel(m)}</span>
                    </div>
                  </div>
                  {m.favorite && <span className="text-amber-400 text-sm">⭐</span>}
                </div>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </PageShell>
  );
}
