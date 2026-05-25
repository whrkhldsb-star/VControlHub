import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listMediaItems } from "@/lib/media/service";
import { PageShell, Card, PermissionDenied } from "@/components/page-shell";
import { MediaScanButton } from "./media-scan-button";
export const dynamic = "force-dynamic";
export default async function Page() {
	const session = await requireSession("/media");
	if (!sessionHasPermission(session, "storage:read")) return <PermissionDenied />;
	const canManageMedia = sessionHasPermission(session, "media:manage");
	const media = await listMediaItems();
	return (
		<PageShell>
			<h1 className="text-3xl font-semibold text-white">媒体库</h1>
			<p className="mt-2 text-sm text-slate-400">聚合云盘中的图片和视频元数据，支持收藏、标签和媒体类型过滤。</p>
			{canManageMedia && <MediaScanButton />}
			<div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{media.map((m) => (
					<Card key={m.id}>
						<div className="text-sm font-medium">{m.name}</div>
						<p className="mt-1 text-xs text-slate-500">{m.mediaType} · {m.relativePath}</p>
					</Card>
				))}
				{media.length === 0 && <Card>暂无媒体条目，可点击扫描媒体索引从文件索引生成。</Card>}
			</div>
		</PageShell>
	);
}
