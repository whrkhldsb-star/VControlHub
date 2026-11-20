import type { Prisma } from "@prisma/client";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { prisma } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

export async function withAdminInvariantLock<T>(operation: () => Promise<T>): Promise<T> {
  const release = await acquireAdvisoryLock("user-admin-invariant", "global");
  try {
    return await operation();
  } finally {
    await release();
  }
}

export async function assertAdminAccessMayBeRemoved(userId: string, db: Prisma.TransactionClient = prisma): Promise<void> {
  const target = await db.user.findUnique({
    where: { id: userId },
    select: { roles: { select: { role: { select: { key: true } } } } },
  });
  if (!target?.roles?.some((entry) => entry.role.key === "admin")) return;

  const remainingActiveAdmins = await db.user.count({
    where: {
      id: { not: userId },
      status: { not: "DISABLED" },
      roles: { some: { role: { key: "admin" } } },
    },
  });
  if (remainingActiveAdmins === 0) {
    throw new ConflictError(t("backend.user.cannotRemoveLastAdmin"));
  }
}
