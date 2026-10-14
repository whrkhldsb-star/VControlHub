/**
 * Status board site settings (one row, id "default"). A missing row means
 * the board is closed — that is the state after the migration.
 */
import { prisma } from "@/lib/db";
import {
	ANNOUNCEMENT_MAX,
	DESCRIPTION_MAX,
	PUBLIC_METRIC_CATEGORIES,
	TITLE_MAX,
	cleanPlainText,
	siteConfigFromRow,
	type PublicSiteConfig,
	type PublicSiteUpdate,
} from "./site-config";

const SITE_SELECT = {
	enabled: true,
	title: true,
	description: true,
	announcement: true,
	defaultView: true,
	refreshSeconds: true,
	accent: true,
	metrics: true,
	showPlatformStatus: true,
	updatedAt: true,
} as const;

export async function loadPublicSite(): Promise<PublicSiteConfig> {
	const row = await prisma.publicStatusSite.findUnique({ where: { id: "default" }, select: SITE_SELECT });
	return siteConfigFromRow(row);
}

export async function savePublicSite(input: PublicSiteUpdate, actorId: string): Promise<PublicSiteConfig> {
	const data = {
		enabled: input.enabled,
		title: cleanPlainText(input.title, TITLE_MAX),
		description: cleanPlainText(input.description, DESCRIPTION_MAX),
		announcement: cleanPlainText(input.announcement, ANNOUNCEMENT_MAX),
		defaultView: input.defaultView,
		refreshSeconds: input.refreshSeconds,
		accent: input.accent,
		metrics: PUBLIC_METRIC_CATEGORIES.filter((category) => input.metrics.includes(category)),
		showPlatformStatus: input.showPlatformStatus,
		updatedById: actorId,
	};
	const row = await prisma.publicStatusSite.upsert({
		where: { id: "default" },
		create: { id: "default", ...data },
		update: data,
		select: SITE_SELECT,
	});
	return siteConfigFromRow(row);
}
