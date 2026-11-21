import type { Prisma } from "@prisma/client";

/** Serialize credential, role and membership decisions for an existing account. */
export async function lockUserRow(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
}
