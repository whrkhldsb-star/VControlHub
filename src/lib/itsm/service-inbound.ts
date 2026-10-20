import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { createLogger } from "@/lib/logging";
import { addTicketComment, createTicket, updateTicketStatus } from "@/lib/ticket/service";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";

import { normalizeInboundTicket, verifyInboundSignature } from "./adapters";
import {
  decryptCredentials,
  parseConfig,
  recordEvent,
  supportsInbound,
  toEventRecord,
} from "./service-internals";
import type { ItsmEventRecord } from "./types";

const logger = createLogger("itsm");

function normalizeStatus(raw: string | null): string | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  const map: Record<string, string> = {
    OPEN: "OPEN",
    IN_PROGRESS: "IN_PROGRESS",
    INPROGRESS: "IN_PROGRESS",
    RESOLVED: "RESOLVED",
    CLOSED: "CLOSED",
    CLOSE: "CLOSED",
  };
  return map[upper] ?? null;
}

function normalizePriority(raw: string | null | undefined, fallback = "NORMAL"): string {
  if (!raw) return fallback;
  const upper = raw.trim().toUpperCase();
  if (upper === "MEDIUM") return "NORMAL";
  if (["LOW", "NORMAL", "HIGH", "URGENT"].includes(upper)) return upper;
  return fallback;
}

type InboundClaim = {
  id: string;
  /** A previous attempt already performed the side effect (ticket/comment/status). */
  applied: boolean;
  action: string | null;
  ticketId: string | null;
};

/**
 * Claim the (connection, externalId) event row before doing anything. A row
 * that finished (ok/ignored) is a genuine duplicate. A row left in error or
 * pending by an earlier attempt is reused — the unique (connectionId,
 * externalId) index allows one row — so the sender's retry is processed
 * instead of being answered with the old failure forever.
 */
async function claimInboundEvent(
  connectionId: string,
  externalId: string,
  eventType: string,
): Promise<{ done: ItsmEventRecord } | { done: null; claim: InboundClaim }> {
  const existing = await prisma.itsmEvent.findFirst({
    where: { connectionId, externalId },
    orderBy: { createdAt: "desc" },
  });
  if (existing && (existing.status === "ok" || existing.status === "ignored")) {
    return { done: toEventRecord(existing) };
  }
  if (existing) {
    const payload = toEventRecord(existing).payload;
    await prisma.itsmEvent.update({
      where: { id: existing.id },
      data: { status: "pending", errorMessage: null, eventType },
    });
    const claim: InboundClaim = {
      id: existing.id,
      applied: payload.applied === true,
      action: typeof payload.action === "string" ? payload.action : null,
      ticketId: existing.ticketId,
    };
    return { done: null, claim };
  }
  const row = await prisma.itsmEvent.create({
    data: { connectionId, direction: "inbound", eventType, status: "pending", externalId, payload: {} },
  });
  const claim: InboundClaim = { id: row.id, applied: false, action: null, ticketId: null };
  return { done: null, claim };
}

/**
 * Record that the side effect happened (see InboundClaim.applied). Called on
 * the side effect's own transaction, so the business write and this marker
 * commit together or not at all: a retry can never find the ticket/comment/
 * status change applied while the marker says it was not.
 */
async function markApplied(db: Prisma.TransactionClient, claim: InboundClaim | null, action: string, ticketId: string | null) {
  if (!claim) return;
  await db.itsmEvent.update({
    where: { id: claim.id },
    data: { ticketId, payload: { action, applied: true } },
  });
}

export async function handleInboundWebhook(input: {
  connectionId: string;
  rawBody: string;
  signatureHeader: string | null;
  json: Record<string, unknown>;
  systemUserId: string;
}): Promise<{ event: ItsmEventRecord; ticketId: string | null; action: string }> {
  const row = await prisma.itsmConnection.findUnique({ where: { id: input.connectionId } });
  // A deleted customer's connection takes no events until it is restored:
  // they would keep creating and changing its hidden tickets.
  if (!row || (row.teamId && (await prisma.team.count({ where: { id: row.teamId, deletedAt: { not: null } } })) > 0)) {
    throw new NotFoundError(t("backend.itsm.itsmConnectionNotFound"));
  }
  if (!row.enabled) throw new ValidationError(t("backend.itsm.connectionIsDisabled"));
  if (!supportsInbound(row.direction)) {
    throw new ValidationError(t("backend.itsm.connectionDoesNotAcceptInboundEvents"));
  }
  const credentials = decryptCredentials(row.credentialsEnc);
  const config = parseConfig(row.config);
  const verified = verifyInboundSignature({
    rawBody: input.rawBody,
    headerSignature: input.signatureHeader,
    secret: credentials.webhookSecret ?? credentials.signingSecret,
  });
  if (!verified.ok) {
    await recordEvent({
      connectionId: row.id,
      direction: "inbound",
      eventType: "security.rejected",
      status: "error",
      payload: { reason: verified.error },
      errorMessage: verified.error,
    });
    await prisma.itsmConnection.update({ where: { id: row.id }, data: { lastError: verified.error } });
    throw new ForbiddenError(verified.error);
  }

  const normalized = normalizeInboundTicket(input.json);
  const eventType = normalized.eventType;
  let ticketId = normalized.ticketId;
  let action = "ignored";
  const releaseIdempotencyLock = normalized.externalId
    ? await acquireAdvisoryLock("itsm-inbound", `${row.id}:${normalized.externalId}`)
    : async () => undefined;
  let claim: InboundClaim | null = null;
  try {
    if (normalized.externalId) {
      const claimed = await claimInboundEvent(row.id, normalized.externalId, eventType);
      if (claimed.done) {
        const event = claimed.done;
        const previousAction = typeof event.payload.action === "string"
          ? event.payload.action
          : "duplicate";
        return { event, ticketId: event.ticketId, action: previousAction };
      }
      claim = claimed.claim;
    }

    if (claim?.applied) {
      // The side effect already happened on an earlier attempt that then
      // failed to record its outcome: finish the bookkeeping, never repeat it.
      action = claim.action ?? "acknowledged";
      ticketId = claim.ticketId ?? ticketId;
    } else if (normalized.commentBody && ticketId) {
      const commentTarget = await prisma.ticket.findFirst({
        where: {
          id: ticketId,
          teamId: row.teamId,
        },
        select: { id: true },
      });
      if (!commentTarget) {
        throw new NotFoundError(t("backend.itsm.ticketNotFoundForThisConnectionTeam"));
      }
      const commentTicketId = ticketId;
      await prisma.$transaction(async (tx) => {
        await addTicketComment({
          ticketId: commentTicketId,
          authorId: input.systemUserId,
          body: `[ITSM inbound] ${normalized.commentBody}`,
          skipItsmFanOut: true,
          db: tx,
        });
        await markApplied(tx, claim, "comment", commentTicketId);
      });
      action = "comment";
    } else if (
      (eventType.includes("create") || !ticketId) &&
      config.createOnInbound !== false &&
      normalized.title
    ) {
      const title = normalized.title;
      const ticket = await prisma.$transaction(async (tx) => {
        const created = await createTicket({
          title,
          description: normalized.description || title,
          priority: normalizePriority(normalized.priority ?? config.defaultPriority),
          category: normalized.category ?? config.defaultCategory,
          createdBy: input.systemUserId,
          skipItsmFanOut: true,
          session: row.teamId ? { currentTeamId: row.teamId } : undefined,
          db: tx,
        });
        await markApplied(tx, claim, "create", created.id);
        return created;
      });
      ticketId = ticket.id;
      action = "create";
    } else if (ticketId && normalized.status) {
      const status = normalizeStatus(normalized.status);
      if (status) {
        const statusTarget = await prisma.ticket.findFirst({
          where: {
            id: ticketId,
            teamId: row.teamId,
          },
          select: { id: true },
        });
        if (!statusTarget) {
          throw new NotFoundError(t("backend.itsm.ticketNotFoundForThisConnectionTeam"));
        }
        const statusTicketId = ticketId;
        await prisma.$transaction(async (tx) => {
          await updateTicketStatus({ id: statusTicketId, status, skipItsmFanOut: true, db: tx });
          await markApplied(tx, claim, "status_update", statusTicketId);
        });
        action = "status_update";
      } else {
        action = "ignored_status";
      }
    } else if (ticketId) {
      action = "acknowledged";
    } else {
      action = "ignored_no_ticket";
    }

    const finalStatus = action.startsWith("ignored") ? "ignored" : "ok";
    const finalPayload = { action, title: normalized.title, status: normalized.status, applied: !action.startsWith("ignored") };
    const event = claim
      ? toEventRecord(await prisma.itsmEvent.update({
        where: { id: claim.id },
        data: { status: finalStatus, ticketId, payload: finalPayload, errorMessage: null },
      }))
      : await recordEvent({
        connectionId: row.id,
        direction: "inbound",
        eventType,
        ticketId,
        status: finalStatus,
        externalId: normalized.externalId,
        payload: finalPayload,
      });
    await prisma.itsmConnection.update({
      where: { id: row.id },
      data: { lastInboundAt: new Date(), lastError: null },
    });
    return { event, ticketId, action };
  } catch (err) {
    const message = err instanceof Error ? err.message : "inbound processing failed";
    if (claim) {
      // Keep the claim row (and any applied marker) so the sender's retry is
      // processed — and does not repeat a side effect that already happened.
      await prisma.itsmEvent.update({
        where: { id: claim.id },
        data: { status: "error", errorMessage: message.slice(0, 2000) },
      }).catch((recordError) => logger.error("failed to record inbound event failure", recordError, { connectionId: row.id }));
    } else {
      await recordEvent({
        connectionId: row.id,
        direction: "inbound",
        eventType,
        ticketId,
        status: "error",
        externalId: normalized.externalId,
        payload: { action: "error" },
        errorMessage: message,
      });
    }
    await prisma.itsmConnection.update({
      where: { id: row.id },
      data: { lastInboundAt: new Date(), lastError: message },
    });
    logger.error("inbound webhook processing failed", err, {
      connectionId: row.id,
      eventType,
    });
    throw err instanceof Error ? err : new Error(message);
  } finally {
    await releaseIdempotencyLock();
  }
}
