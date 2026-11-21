import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/** Keep a caller's transaction when an inbound event owns the commit. */
export function withTicketTransaction<T>(db: Prisma.TransactionClient | undefined, write: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db ? write(db) : prisma.$transaction(write);
}

export async function lockTicket(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM tickets WHERE id = ${id} FOR NO KEY UPDATE`;
}
