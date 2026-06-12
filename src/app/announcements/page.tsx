import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listActiveAnnouncements, listAnnouncements } from "@/lib/announcement/service";
import { PageShell, PageHeader } from "@/components/page-shell";
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
			<PageHeader eyebrow="Announcements" title="站内公告" description="展示当前有效、置顶优先的站内消息。" className="mb-6" />

			{canManage && <div className="mb-6"><CreateAnnouncementForm /></div>}

			<AnnouncementList items={serialized} canManage={canManage} />
		</PageShell>
	);
}
