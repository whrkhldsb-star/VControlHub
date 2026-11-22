import { createHash } from "node:crypto";
import type { SessionPayload } from "@/lib/auth/session";
import { seesAllCustomers, teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { createLogger } from "@/lib/logging";
import { lockOutboundStream, readTicketSnapshot, reconcileLegacyDestination, scheduleDelivery } from "./outbox";
import type { ItsmEvent, Prisma } from "@prisma/client";

import { assertOutboundReady, deliverOutbound } from "./adapters";
import {
  decryptCredentials,
  parseConfig,
  recordEvent,
  supportsOutbound,
} from "./service-internals";
import type { ItsmEventRecord, ItsmProvider } from "./types";

const logger = createLogger("itsm");

export async function testItsmConnection(
  id: string,
  message?: string,
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
): Promise<{ ok: boolean; event: ItsmEventRecord; error?: string }> {
  const row = await prisma.itsmConnection.findFirst({
    where: { id, ...(session ? teamWhere(session) : {}) },
  });
  if (!row) throw new NotFoundError(t("backend.itsm.itsmConnectionNotFound"));
  if (!row.enabled) throw new ValidationError(t("backend.itsm.connectionIsDisabled"));
  if (!supportsOutbound(row.direction)) {
    throw new ValidationError(t("backend.itsm.connectionDoesNotSupportOutboundDelivery"));
  }
  const config = parseConfig(row.config);
  const credentials = decryptCredentials(row.credentialsEnc);
  assertOutboundReady(row.provider as ItsmProvider, config, credentials);
  const payload = {
    ticketId: "test",
    title: "ITSM connectivity test",
    description: message?.trim() || "VControlHub ITSM outbound test ping",
    status: "OPEN",
    priority: "NORMAL",
    eventType: "connection.test",
  };
  const delivery = await deliverOutbound({
    provider: row.provider as ItsmProvider,
    config,
    credentials,
    payload,
  });
  const event = await recordEvent({
    connectionId: row.id,
    teamId: row.teamId,
    direction: "outbound",
    eventType: "connection.test",
    ticketId: null,
    status: delivery.outcomeUnknown ? "unknown" : delivery.ok ? "ok" : "error",
    payload: {
      message: payload.description,
      statusCode: delivery.statusCode ?? null,
      responseBody: delivery.responseBody ?? null,
    },
    errorMessage: delivery.ok ? null : delivery.error ?? "delivery failed",
  });
  const claimed = await prisma.itsmConnection.updateMany({
    where: { id: row.id, ...(session ? teamWhere(session) : {}) },
    data: {
      lastOutboundAt: new Date(),
      lastError: delivery.ok ? null : delivery.error ?? "delivery failed",
    },
  });
  if (claimed.count === 0) throw new NotFoundError(t("backend.itsm.itsmConnectionNotFound"));
  return { ok: delivery.ok, event, error: delivery.ok ? undefined : delivery.error };
}

async function advanceStream(tx: Prisma.TransactionClient, event: ItsmEvent) {
  const next = await tx.itsmEvent.findFirst({ where: {
    ticketId: event.ticketId, connectionId: event.connectionId, teamId: event.teamId,
    ownerBound: true, direction: "outbound", status: { in: ["pending", "error"] },
    payload: { path: ["predecessor"], equals: event.id },
  } });
  if (next) await scheduleDelivery(tx, next);
}

async function predecessorComplete(db: Prisma.TransactionClient, payload: Prisma.JsonObject) {
  if (typeof payload.predecessor !== "string") return true;
  const prior = await db.itsmEvent.findUnique({ where: { id: payload.predecessor }, select: { status: true } });
  // Retention only removes terminal receipts.
  return !prior || prior.status === "ok" || prior.status === "ignored";
}

async function withDeliveryLock<T>(id: string, work: () => Promise<T>) {
  const release = await acquireAdvisoryLock("itsm-delivery", id);
  try {
    return await work();
  } finally {
    await release();
  }
}

export function deliverQueuedEvent(id: string) {
  return withDeliveryLock(id, () => deliverReservedEvent(id));
}

/** Reserve a delivery before any network I/O. A process death after this point
 * leaves a visible unknown receipt. A receiver without an idempotency contract
 * must be reconciled before its next event can run. */
async function deliverReservedEvent(id: string): Promise<{ sent: number; failed: number }> {
  const event = await prisma.itsmEvent.findUniqueOrThrow({ where: { id } });
  if (!event.ownerBound || event.direction !== "outbound" || !event.ticketId || !event.externalId) throw new Error("Invalid ITSM outbox event");
  if (event.status === "ok" || event.status === "ignored") return { sent: Number(event.status === "ok"), failed: 0 };
  const payload = event.payload as Prisma.JsonObject;
  if (!await predecessorComplete(prisma, payload)) return { sent: 0, failed: 1 };
  const snapshot = readTicketSnapshot(payload.snapshot ?? null);
  if (snapshot.teamId !== event.teamId || snapshot.ticketId !== event.ticketId) throw new Error("Invalid ITSM event owner");
  const row = event.connectionId ? await prisma.itsmConnection.findFirst({
    where: { id: event.connectionId, teamId: event.teamId, enabled: true, direction: { in: ["outbound", "bidirectional"] } },
  }) : null;
  const live = !event.teamId || await prisma.team.findFirst({ where: { id: event.teamId, deletedAt: null }, select: { id: true } });
  const finish = async (status: string, errorMessage: string | null, receipt: Prisma.InputJsonObject = {}) => {
    await prisma.$transaction(async (tx) => {
      await lockOutboundStream(tx, snapshot.ticketId);
      const terminal = status === "ok" || status === "ignored";
      const updated = await tx.itsmEvent.updateMany({
        where: { id, status: { notIn: ["ok", "ignored"] } },
        data: { status, errorMessage, payload: { ...payload, ...receipt, ...(terminal ? { terminalAtMs: Date.now() } : {}) } },
      });
      if (!updated.count) return;
      if (row && live) await tx.itsmConnection.updateMany({
        where: { id: row.id, teamId: event.teamId }, data: { lastOutboundAt: new Date(), lastError: errorMessage },
      });
      if (terminal) await advanceStream(tx, event);
    });
  };
  if (!row || !live) {
    await finish("ignored", t("backend.itsm.connectionIsDisabled"));
    return { sent: 0, failed: 0 };
  }
  let config;
  let credentials;
  let idempotencyScope: string | null;
  try {
    config = parseConfig(row.config);
    // A changed URL, credential, or receiver contract cannot deduplicate an earlier send.
    idempotencyScope = row.provider === "generic_webhook" && config.idempotentDelivery === true
      ? createHash("sha256").update(JSON.stringify([config.webhookUrl, config.headers, row.credentialsEnc])).digest("hex")
      : null;
    if (event.status === "unknown" && (!idempotencyScope || payload.idempotencyScope !== idempotencyScope)) return { sent: 0, failed: 1 };
    credentials = decryptCredentials(row.credentialsEnc);
    assertOutboundReady(row.provider as ItsmProvider, config, credentials);
  } catch (error) {
    await finish(event.status === "unknown" ? "unknown" : "error", error instanceof Error ? error.message : "Invalid connection configuration");
    return { sent: 0, failed: 1 };
  }
  const reserved = await prisma.itsmEvent.updateMany({
    where: { id, status: { in: idempotencyScope ? ["pending", "error", "unknown"] : ["pending", "error"] } },
    data: { status: "unknown", payload: { ...payload, idempotencyScope }, errorMessage: null },
  });
  if (!reserved.count) return { sent: 0, failed: 1 };
  const delivery = await deliverOutbound({
    provider: row.provider as ItsmProvider, config, credentials,
    payload: { ...snapshot, eventId: event.externalId, occurredAt: event.createdAt.toISOString() },
  });
  // A rejected retry does not settle a previous attempt whose response was lost.
  const status = delivery.ok ? "ok" : delivery.outcomeUnknown || event.status === "unknown" ? "unknown" : "error";
  await finish(status, delivery.error ?? null, { idempotencyScope, statusCode: delivery.statusCode ?? null, responseBody: delivery.responseBody ?? null });
  logger.info("ticket event delivery", { id, status, connectionId: row.id });
  return { sent: Number(delivery.ok), failed: Number(!delivery.ok) };
}

/** An operator checked the stable event ID with the receiver. Serialize that
 * decision with sends, then resume the same stream in the receipt transaction. */
export function reconcileDelivery(session: SessionPayload, id: string, received: boolean) {
  return withDeliveryLock(id, () => prisma.$transaction(async (tx) => {
    const owner = seesAllCustomers(session) ? {} : {
      teamId: session.currentTeamId,
      ...(!session.currentTeamId ? { connection: { createdById: session.userId, teamId: null } } : {}),
    };
    const event = await tx.itsmEvent.findFirst({ where: { id, ...owner, ...(seesAllCustomers(session) ? {} : { ownerBound: true }), direction: "outbound" } });
    if (!event) throw new NotFoundError();
    if (!event.ownerBound) {
      const bound = await reconcileLegacyDestination(tx, event, received, session.userId);
      if (received) await advanceStream(tx, bound);
      return { id: bound.id, status: bound.status };
    }
    const payload = event.payload as Prisma.JsonObject;
    const canReconcile = event.status === "unknown" || (event.status === "error" && !received);
    if (!canReconcile || !event.ticketId || !payload.snapshot) throw new ConflictError();
    await lockOutboundStream(tx, event.ticketId);
    if (!await predecessorComplete(tx, payload)) throw new ConflictError();
    const updated = await tx.itsmEvent.update({ where: { id }, data: {
      status: received ? "ok" : "pending", errorMessage: null,
      payload: { ...payload, reconciledBy: session.userId, reconciledAt: new Date().toISOString(), ...(received ? { terminalAtMs: Date.now() } : {}) },
    } });
    if (received) await advanceStream(tx, updated);
    else await scheduleDelivery(tx, updated);
    return { id, status: updated.status };
  }));
}
