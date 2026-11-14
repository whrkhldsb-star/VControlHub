import { requireSession } from "@/lib/auth/require-session";
import { canManageAnnouncements, listActiveAnnouncements, listAnnouncements } from "@/lib/announcement/service";
import { PageShell } from "@/components/page-shell";
import { AnnouncementsPageClient } from "./announcements-page-client";
import { getServerLocale, t } from "@/lib/i18n/translations";

// Management mutations call router.refresh(); this page must not serve a
// minute-old cached list immediately after create/edit/delete.
export const dynamic = "force-dynamic";

/** The list and the clock it was read at: the client computes the visibility badges against that instant. */
async function loadAnnouncements(canManage: boolean) {
	const items = canManage ? await listAnnouncements() : await listActiveAnnouncements();
	return { items, now: Date.now() };
}

/** Every signed-in account reads active announcements; platform administrators publish them. */
export default async function AnnouncementsPage() {
	const session = await requireSession("/announcements");
	const canManage = canManageAnnouncements(session);
	const locale = await getServerLocale();
	const { items, now } = await loadAnnouncements(canManage);

	const serialized = items.map((a) => ({
		id: a.id,
		title: a.title,
		body: a.body,
		level: a.level,
		pinned: a.pinned,
		published: "published" in a ? Boolean(a.published) : true,
		startsAt: a.startsAt.toISOString(),
		expiresAt: a.expiresAt ? a.expiresAt.toISOString() : null,
	}));

	return (
		<PageShell>
			<AnnouncementsPageClient
				header={{ eyebrow: t("announcementsPage.eyebrow", locale), title: t("announcementsPage.title", locale), description: t("announcementsPage.desc", locale) }}
				canManage={canManage}
				items={serialized}
				now={now}
			/>
		</PageShell>
	);
}
