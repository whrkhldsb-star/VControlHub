import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listActiveAnnouncements, listAnnouncements } from "@/lib/announcement/service";
import { PageShell } from "@/components/page-shell";
import { CreateAnnouncementForm } from "./create-announcement-form";
import { AnnouncementList } from "./announcement-list-client";

export const dynamic = "force-dynamic";

export default async function AnnouncementsPage() {
	const session = await requireSession("/announcements");
	const canManage = sessionHasPermission(session, "announcement:manage");
	const items = canManage ? await listAnnouncements() : await listActiveAnnouncements();

	const serialized = items.map((a) => ({
		id: a.id,
		title: a.title,
		body: a.body,
		level: a.level,
		pinned: a.pinned,
		startsAt: a.startsAt.toISOString(),
		expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
	}));

	return (
		<PageShell maxW="max-w-4xl">
			<header className="mb-6">
				<p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">Announcements</p>
				<h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">站内公告</h1>
				<p className="mt-1.5 text-sm text-slate-500">展示当前有效、置顶优先的站内消息。</p>
			</header>

			{canManage && <div className="mb-6"><CreateAnnouncementForm /></div>}

			<AnnouncementList items={serialized} canManage={canManage} />
		</PageShell>
	);
}
