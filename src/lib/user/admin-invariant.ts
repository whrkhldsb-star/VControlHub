import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { prisma } from "@/lib/db";
import { ConflictError } from "@/lib/errors";

export async function withAdminInvariantLock<T>(operation: () => Promise<T>): Promise<T> {
  const release = await acquireAdvisoryLock("user-admin-invariant", "global");
  try {
    return await operation();
  } finally {
    await release();
  }
}

export async function assertAdminAccessMayBeRemoved(userId: string): Promise<void> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { roles: { select: { role: { select: { key: true } } } } },
  });
  if (!target?.roles?.some((entry) => entry.role.key === "admin")) return;

  const remainingActiveAdmins = await prisma.user.count({
    where: {
      id: { not: userId },
      status: { not: "DISABLED" },
      roles: { some: { role: { key: "admin" } } },
    },
  });
  if (remainingActiveAdmins === 0) {
    throw new ConflictError("The last active administrator cannot be disabled or stripped of the admin role");
  }
}
