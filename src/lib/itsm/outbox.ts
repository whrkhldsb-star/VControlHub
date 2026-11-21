import { randomUUID } from "node:crypto";
import type { Prisma, Ticket } from "@prisma/client";
import { lockForTransaction } from "@/lib/concurrency/advisory-lock";
import { prisma } from "@/lib/db";
import { enqueueJob } from "@/lib/job/service";
import type { ItsmOutboundTicketPayload } from "./types";

export const ITSM_OUTBOUND_JOB_TYPE = "itsm.outbound";
export type TicketSnapshot = ItsmOutboundTicketPayload & { teamId: string | null };

export function readTicketSnapshot(raw: Prisma.JsonValue): TicketSnapshot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid ITSM outbound job payload");
  const field = (key: string) => {
    const value = raw[key];
    if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid ITSM outbound payload field: ${key}`);
    return value;
  };
  return {
    ticketId: field("ticketId"), eventType: field("eventType"), title: field("title"),
    description: field("description"), status: field("status"), priority: field("priority"),
    category: typeof raw.category === "string" ? raw.category : null,
    ...(typeof raw.commentBody === "string" ? { commentBody: raw.commentBody } : {}),
    teamId: typeof raw.teamId === "string" ? raw.teamId : null,
  };
}

export async function lockOutboundStream(tx: Prisma.TransactionClient, ticketId: string) {
  // A receipt can advance the queue concurrently with a ticket edit appending to it.
  await lockForTransaction(tx, "itsm-outbox", ticketId);
}

export async function scheduleDelivery(tx: Prisma.TransactionClient, event: { id: string; eventType: string; teamId: string | null }) {
  await enqueueJob({
    type: ITSM_OUTBOUND_JOB_TYPE, title: `ITSM ${event.eventType}`,
    payload: { eventId: event.id }, teamId: event.teamId, maxAttempts: 5, priority: 1,
  }, tx);
}

// Called under the stream lock. Each connection owns an independent FIFO. A tail
// is durable, but only the head gets a runnable job. Its receipt schedules the next.
async function appendSnapshot(tx: Prisma.TransactionClient, snapshot: TicketSnapshot, externalId: string, superseded: string[] = []) {
  const connections = await tx.itsmConnection.findMany({
    where: {
      teamId: snapshot.teamId, enabled: true, direction: { in: ["outbound", "bidirectional"] },
      ...(superseded.length ? { id: { notIn: superseded } } : {}),
    },
    select: { id: true },
  });
  for (const connection of connections) {
    const scope = { connectionId: connection.id, ticketId: snapshot.ticketId, teamId: snapshot.teamId, ownerBound: true, direction: "outbound" };
    const existing = await tx.itsmEvent.findUnique({ where: { connectionId_externalId: { connectionId: connection.id, externalId } } });
    // Old receipts are immutable across customers and directions.
    if (existing && (!existing.ownerBound || existing.teamId !== snapshot.teamId || existing.direction !== "outbound" || existing.ticketId !== snapshot.ticketId)) continue;
    if (existing?.status === "ok" || existing?.status === "ignored") continue;
    const [previous] = await tx.$queryRaw<{ id: string; status: string; sequence: number }[]>`
      SELECT id, status, (payload->>'sequence')::float8 AS sequence FROM itsm_events
      WHERE "connectionId" = ${connection.id} AND "ticketId" = ${snapshot.ticketId}
        AND "teamId" IS NOT DISTINCT FROM ${snapshot.teamId} AND "ownerBound" AND direction = 'outbound'
        AND payload ? 'sequence' ORDER BY sequence DESC LIMIT 1
    `;
    const predecessor = previous && previous.status !== "ok" && previous.status !== "ignored" ? previous.id : null;
    const payload = { snapshot, sequence: Math.max(Date.now(), (previous?.sequence ?? 0) + 1), predecessor };
    const event = existing
      ? await tx.itsmEvent.update({ where: { id: existing.id }, data: { payload } })
      : await tx.itsmEvent.create({ data: { ...scope, externalId, eventType: snapshot.eventType, status: "pending", payload } });
    if (!predecessor && event.status !== "unknown") await scheduleDelivery(tx, event);
  }
}

/** Adopt pre-outbox jobs, in their original queue order, before appending new work. */
async function adoptQueuedSnapshots(tx: Prisma.TransactionClient, ticketId: string) {
  const legacy = await tx.$queryRaw<{ id: string; payload: Prisma.JsonValue; createdAt: Date }[]>`
    SELECT id, payload, "createdAt" FROM jobs WHERE type = 'itsm.outbound' AND status IN ('PENDING', 'RUNNING')
      AND payload->>'ticketId' = ${ticketId} AND NOT (payload ? 'adopted')
    ORDER BY "createdAt", id
  `;
  for (const job of legacy) {
    let snapshot;
    try {
      snapshot = readTicketSnapshot(job.payload);
    } catch {
      // Its original worker reports the malformed job. Other ticket writes can still commit.
      continue;
    }
    // An older worker could already have delivered a later status while this
    // one was in backoff. Only supersede state at destinations with a receipt.
    const stateOnly = ["ticket.updated", "ticket.status_changed"].includes(snapshot.eventType) && !snapshot.commentBody;
    const newer = stateOnly ? await tx.$queryRaw<{ connectionId: string }[]>`
      SELECT DISTINCT e."connectionId" FROM itsm_events e JOIN jobs j ON j.id = e."externalId"
      WHERE e.direction = 'outbound' AND e."ownerBound" AND e.status = 'ok' AND e."ticketId" = ${ticketId}
        AND e."teamId" IS NOT DISTINCT FROM ${snapshot.teamId} AND e."connectionId" IS NOT NULL
        AND e."eventType" IN ('ticket.updated', 'ticket.status_changed') AND j.type = 'itsm.outbound'
        AND (j."createdAt", j.id) > (${job.createdAt}, ${job.id})
    ` : [];
    const superseded = newer.map((receipt) => receipt.connectionId);
    if (superseded.length) await tx.itsmEvent.updateMany({
      where: { direction: "outbound", ownerBound: true, teamId: snapshot.teamId, ticketId, connectionId: { in: superseded },
        externalId: job.id, status: { in: ["pending", "error", "unknown"] } },
      data: { status: "ignored", payload: { superseded: true, terminalAtMs: Date.now() }, errorMessage: null },
    });
    await appendSnapshot(tx, snapshot, job.id, superseded);
    await tx.job.update({ where: { id: job.id }, data: { payload: { ...snapshot, adopted: true } } });
  }
}

export function adoptLegacyTicketJobs(ticketId: string) {
  return prisma.$transaction(async (tx) => {
    await lockOutboundStream(tx, ticketId);
    await adoptQueuedSnapshots(tx, ticketId);
  });
}

export async function enqueueTicketEvent(
  tx: Prisma.TransactionClient, ticket: Pick<Ticket, "id" | "title" | "description" | "status" | "priority" | "category" | "teamId">,
  eventType: string, commentBody?: string,
) {
  const { id: ticketId, title, description, status, priority, category, teamId } = ticket;
  await lockOutboundStream(tx, ticketId);
  await adoptQueuedSnapshots(tx, ticketId);
  await appendSnapshot(tx, {
    ticketId, title, description, status, priority, category, teamId, eventType,
    ...(commentBody === undefined ? {} : { commentBody }),
  }, randomUUID());
}
