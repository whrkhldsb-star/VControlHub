import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listActiveAnnouncements, listAnnouncements } from "@/lib/announcement/service";
import { PageShell, PageHeader } from "@/components/page-shell";
import { CreateAnnouncementForm } from "./create-announcement-form";
import { AnnouncementList } from "./announcement-list-client";
import { getServerLocale, t } from "@/lib/i18n/translations";

// Management mutations call router.refresh(); this page must not serve a
// minute-old cached list immediately after create/edit/delete.
export const dynamic = "force-dynamic";

export default async function AnnouncementsPage() {
	const session = await requireSession("/announcements");
	const canManage = sessionHasPermission(session, "announcement:manage");
	const locale = await getServerLocale();
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
			<PageHeader eyebrow={t("announcementsPage.eyebrow", locale)} title={t("announcementsPage.title", locale)} description={t("announcementsPage.desc", locale)} className="mb-6" />

			{canManage && <div className="mb-6"><CreateAnnouncementForm /></div>}

			<AnnouncementList
				key={serialized.map((item) => item.id).join("|")}
				items={serialized}
				canManage={canManage}
			/>
		</PageShell>
	);
}
