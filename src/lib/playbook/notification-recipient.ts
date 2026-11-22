import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PLATFORM_ADMIN_WHERE } from "@/lib/auth/permission-holders";

/** A platform playbook sends a private platform inbox row. Only administrators can open it. */
export async function canReceivePlaybookNotification(userId: string, teamId: string | null, db: Prisma.TransactionClient = prisma) {
  if (teamId) return Boolean(await db.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId }, team: { deletedAt: null }, user: { status: { not: "DISABLED" } } },
    select: { userId: true },
  }));
  return Boolean(await db.user.findFirst({
    where: { id: userId, status: { not: "DISABLED" }, ...PLATFORM_ADMIN_WHERE }, select: { id: true },
  }));
}
