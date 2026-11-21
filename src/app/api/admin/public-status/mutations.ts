import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/service";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { generatePublicId, normalizePublication, type NodePublicationInput } from "@/lib/public-status/nodes-admin";
import {
	ANNOUNCEMENT_MAX, DESCRIPTION_MAX, PUBLIC_METRIC_CATEGORIES, TITLE_MAX, cleanPlainText,
	siteConfigFromRow, type PublicSiteUpdate,
} from "@/lib/public-status/site-config";

export async function saveAuditedSite(input: PublicSiteUpdate, actorId: string) {
	const fields = {
		title: cleanPlainText(input.title, TITLE_MAX), description: cleanPlainText(input.description, DESCRIPTION_MAX),
		announcement: cleanPlainText(input.announcement, ANNOUNCEMENT_MAX), defaultView: input.defaultView,
		refreshSeconds: input.refreshSeconds, accent: input.accent, showPlatformStatus: input.showPlatformStatus,
		metrics: PUBLIC_METRIC_CATEGORIES.filter(category => input.metrics.includes(category)), updatedById: actorId,
	};
	return prisma.$transaction(async tx => {
		// Upsert the other fields first. This also locks a previously absent singleton.
		const where = { id: "default" };
		const before = await tx.publicStatusSite.upsert({ where, create: { ...where, ...fields }, update: fields, select: { enabled: true } });
		const site = siteConfigFromRow(await tx.publicStatusSite.update({ where, data: { enabled: input.enabled } }));
		await writeAuditLog({
			actorId, actorType: "USER", action: "public_status.site.update", severity: before.enabled !== site.enabled ? "WARNING" : "INFO",
			detail: { enabledBefore: before.enabled, enabled: site.enabled, metrics: site.metrics, refreshSeconds: site.refreshSeconds, defaultView: site.defaultView },
		}, tx);
		return site;
	});
}

export async function saveAuditedPublication(serverId: string, input: NodePublicationInput, actorId: string) {
	const { published, displayName, ...fields } = normalizePublication(input);
	if (!displayName) throw new ValidationError(t("backend.publicStatus.nameRequired"), { code: "PUBLIC_NAME_REQUIRED" });
	return prisma.$transaction(async tx => {
		const [server] = await tx.$queryRaw<Array<{ host: string; teamId: string | null }>>`
			SELECT host, "teamId" FROM servers WHERE id = ${serverId} FOR SHARE`;
		if (!server) throw new NotFoundError(t("backend.publicStatus.serverNotFound"));
		const host = server.host.trim().toLowerCase();
		if (host && [displayName, fields.groupName, fields.region, fields.note, fields.countryCode, ...fields.tags].some(value => value?.toLowerCase().includes(host))) {
			throw new ValidationError(t("backend.publicStatus.containsHost"), { code: "PUBLIC_FIELD_CONTAINS_HOST" });
		}

		const where = { serverId };
		const before = await tx.publicStatusNode.upsert({
			where, create: { serverId, publicId: generatePublicId(), displayName, ...fields }, update: { displayName, ...fields },
			select: { published: true, publishedAt: true },
		});
		const publishedAt = before.published && before.publishedAt ? before.publishedAt : new Date();
		const saved = await tx.publicStatusNode.update({
			where, data: {
				published, publishedAt: published ? publishedAt : null,
				...(published ? { publishedById: actorId, publishedTeamId: server.teamId } : {}),
			}, select: { published: true, publicId: true },
		});
		const action = before.published === published ? "public_status.node.update"
			: published ? "public_status.node.publish" : "public_status.node.unpublish";
		await writeAuditLog({
			actorType: "USER", actorId, action, severity: action === "public_status.node.publish" ? "WARNING" : "INFO",
			detail: { serverId, publicId: saved.publicId, published, maintenance: fields.maintenance },
		}, tx);
		return saved;
	});
}
