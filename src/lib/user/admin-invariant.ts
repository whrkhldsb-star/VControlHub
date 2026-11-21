import { Prisma } from "@prisma/client";
import { lockForTransaction } from "@/lib/concurrency/advisory-lock";
import { prisma } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

function isTransactionConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2034") return true;
  // The pg adapter wraps SQLSTATE 40001 from raw row locks as a P2010.
  const driverError = error.meta?.driverAdapterError as { cause?: { originalCode?: string } } | undefined;
  return error.code === "P2010" && ["40001", "40P01"].includes(String(driverError?.cause?.originalCode ?? error.meta?.code));
}

export async function withAdminInvariantLock<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  transaction?: Prisma.TransactionClient,
): Promise<T> {
  const run = async (tx: Prisma.TransactionClient) => {
    await lockForTransaction(tx, "user-admin-invariant", "global");
    return operation(tx);
  };
  if (transaction) return run(transaction);
  return withAccountTransaction(run);
}

/** Retry only database work so an aborted attempt never duplicates external effects. */
export async function withAccountTransaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(run, { isolationLevel: "Serializable" });
    } catch (error) {
      if (!isTransactionConflict(error)) throw error;
      if (attempt >= 3) throw new ConflictError(t("backend.concurrency.lockBusy"));
      // Start with a fresh snapshot after a concurrent grant or revocation committed.
    }
  }
}

export async function assertAdminAccessMayBeRemoved(userId: string, db: Prisma.TransactionClient): Promise<void> {
  const target = await db.user.findUnique({
    where: { id: userId },
    select: { roles: { select: { role: { select: { key: true } } } } },
  });
  if (!target?.roles?.some((entry) => entry.role.key === "admin")) return;

  const remainingActiveAdmins = await db.user.count({
    where: {
      id: { not: userId },
      status: "ACTIVE",
      roles: { some: { role: { key: "admin" } } },
    },
  });
  if (remainingActiveAdmins === 0) {
    throw new ConflictError(t("backend.user.cannotRemoveLastAdmin"));
  }
}
