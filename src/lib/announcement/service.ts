import { prisma } from "@/lib/db";

export async function createAnnouncement(input: { title: string; body: string; level?: string; pinned?: boolean; published?: boolean; startsAt?: Date; expiresAt?: Date | null; createdBy?: string }) {
  if (!input.title.trim() || !input.body.trim()) throw new Error("公告标题和内容不能为空");
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
