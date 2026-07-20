import { NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { t } from "@/lib/i18n/translations";

export async function createAnnouncement(input: { title: string; body: string; level?: string; pinned?: boolean; published?: boolean; startsAt?: Date; expiresAt?: Date | null; createdBy?: string }) {
  if (!input.title.trim() || !input.body.trim()) throw new ValidationError(t("backend.announcement.announcementTitleAndContentCannotBeEmpty"));
  return prisma.announcement.create({ data: { title: input.title.trim(), body: input.body.trim(), level: input.level ?? "info", pinned: input.pinned ?? false, published: input.published ?? true, startsAt: input.startsAt ?? new Date(), expiresAt: input.expiresAt ?? null, createdBy: input.createdBy ?? null } });
}

export async function listActiveAnnouncements(now = new Date()) {
	return prisma.announcement.findMany({
		where: { published: true, startsAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
		orderBy: [{ pinned: "desc" }, { startsAt: "desc" }],
		take: 50,
		select: { id: true, title: true, body: true, level: true, pinned: true, createdAt: true, startsAt: true, expiresAt: true },
	});
}

export async function listAnnouncements() {
	return prisma.announcement.findMany({
		orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
		take: 200,
		select: { id: true, title: true, body: true, level: true, pinned: true, createdAt: true, startsAt: true, expiresAt: true },
	});
}

export async function updateAnnouncement(id: string, input: { title?: string; body?: string; level?: string; pinned?: boolean; published?: boolean; expiresAt?: Date | null }) {
	const existing = await prisma.announcement.findUnique({ where: { id } });
	if (!existing) throw new NotFoundError(t("backend.announcement.announcementNotFound"));
	const data: Record<string, unknown> = {};
	if (input.title !== undefined) data.title = input.title.trim();
	if (input.body !== undefined) data.body = input.body.trim();
	if (input.level !== undefined) data.level = input.level;
	if (input.pinned !== undefined) data.pinned = input.pinned;
	if (input.published !== undefined) data.published = input.published;
	if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt;
	if (Object.keys(data).length === 0) return existing;
	return prisma.announcement.update({ where: { id }, data });
}

export async function deleteAnnouncement(id: string) {
	const existing = await prisma.announcement.findUnique({ where: { id } });
	if (!existing) throw new NotFoundError(t("backend.announcement.announcementNotFound"));
	return prisma.announcement.delete({ where: { id } });
}
