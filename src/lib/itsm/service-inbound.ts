import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, BusinessError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { createLogger } from "@/lib/logging";
import { addTicketComment, createTicket, updateTicketStatus } from "@/lib/ticket/service";
import { lockTicket } from "@/lib/ticket/transaction";
import { normalizeTicketPriority } from "@/lib/ticket/priority";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";

import { normalizeInboundTicket, verifyInboundSignature } from "./adapters";
import { inboundSigningSecret } from "./schema";
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

function inboundPriority(value: string | null, defaultPriority?: string) {
  for (const candidate of [value, defaultPriority]) {
    const priority = normalizeTicketPriority(candidate?.trim());
    if (priority && ["LOW", "NORMAL", "HIGH", "URGENT"].includes(priority)) return priority;
  }
  return "NORMAL";
}

type InboundClaim = {
  id: string;
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
  teamId: string | null,
  externalId: string | null,
  eventType: string,
  legacyId?: string,
  truncated?: boolean,
): Promise<{ done: ItsmEventRecord } | { done: null; claim: InboundClaim }> {
  // Events without a sender ID get their own row and applied marker on every delivery.
  let existing = externalId ? await prisma.itsmEvent.findFirst({
    where: { connectionId, externalId },
    orderBy: { createdAt: "desc" },
  }) : null;
  if (legacyId) {
    const legacy = await prisma.itsmEvent.findFirst({ where: { connectionId, externalId: legacyId } });
    if (legacy) {
      // A truncated prefix (or something that also looks like a modern digest)
      // cannot establish the sender identity. Preserve the quarantined receipt.
      if (existing || truncated || /^sha256:[a-f0-9]{64}$/.test(legacyId) || !legacy.ownerBound ||
          legacy.teamId !== teamId || legacy.direction !== "inbound") throw new ConflictError();
      existing = await prisma.itsmEvent.update({ where: { id: legacy.id, externalId: legacyId, teamId, ownerBound: true }, data: { externalId } });
    }
  }
  if (existing && (!existing.ownerBound || existing.teamId !== teamId || existing.direction !== "inbound")) throw new ConflictError();
  if (existing && (existing.status === "ok" || existing.status === "ignored")) {
    return { done: toEventRecord(existing) };
  }
  if (existing) {
    const claim = { id: existing.id };
    return { done: null, claim };
  }
  const row = await prisma.itsmEvent.create({
    data: { connectionId, teamId, ownerBound: true, direction: "inbound", eventType, status: "pending", externalId, payload: { sourceConnectionId: connectionId } },
  });
  const claim: InboundClaim = { id: row.id };
  return { done: null, claim };
}

/** security.rejected events per connection are throttled to one per this interval. */
const REJECTED_EVENT_INTERVAL_MS = 60_000;
const rejectedEventAt = new Map<string, number>();

export async function handleInboundWebhook(input: {
  connectionId: string;
  rawBody: string;
  signatureHeader: string | null;
  /** The request headers, for the provider-specific schemes (A8-02). */
  headers?: { get(name: string): string | null } | null;
  json: Record<string, unknown>;
  systemUserId?: string;
  /** Looked up only once the call has verified (A8-08): a forged request cost 2–3 user queries before. */
  resolveSystemUserId?: (teamId: string | null) => Promise<string | null>;
}): Promise<{ event: ItsmEventRecord; ticketId: string | null; action: string; challenge?: string }> {
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
    secret: inboundSigningSecret(row.provider, credentials),
    provider: row.provider,
    headers: input.headers ?? null,
  });
  if (!verified.ok) {
    // The connection id is printed on the ITSM page as the inbound address, so
    // anyone holding it can send junk: one rejected-event row per connection
    // per minute, and the operator's lastError keeps the real sender's last
    // problem instead of the forger's (A8-08).
    const now = Date.now();
    const last = rejectedEventAt.get(row.id) ?? 0;
    if (now - last >= REJECTED_EVENT_INTERVAL_MS) {
      rejectedEventAt.set(row.id, now);
      await recordEvent({
        connectionId: row.id,
        teamId: row.teamId,
        direction: "inbound",
        eventType: "security.rejected",
        status: "error",
        payload: { reason: verified.error },
        errorMessage: verified.error,
      });
    }
    throw new ForbiddenError(verified.error);
  }

  if (row.provider === "slack" && input.json.type === "url_verification") {
    const challenge = input.json.challenge;
    if (typeof challenge !== "string" || !challenge || challenge.length > 4096) {
      throw new ValidationError(t("apiCopy.validation.invalidValue"), { field: "challenge" });
    }
    const event = await recordEvent({ connectionId: row.id, teamId: row.teamId, direction: "inbound", eventType: "url_verification", status: "ok" });
    return { event, ticketId: null, action: "verified", challenge };
  }

  const systemUserId = input.systemUserId ?? (await input.resolveSystemUserId?.(row.teamId)) ?? null;
  if (!systemUserId) throw new BusinessError(t("backend.itsm.noSystemUserForInbound"), undefined, 503);

  const normalized = normalizeInboundTicket(input.json, row.provider);
  const status = normalizeStatus(normalized.status);
  const eventType = normalized.eventType;
  let ticketId = normalized.ticketId;
  let action = "ignored";
  const releaseIdempotencyLock = normalized.externalId
    ? await acquireAdvisoryLock("itsm-inbound", `${row.id}:${normalized.externalId}`)
    : async () => undefined;
  let claim: InboundClaim | null = null;
  try {
    const claimed = await claimInboundEvent(row.id, row.teamId, normalized.externalId, eventType, normalized.legacyId, normalized.truncated);
    if (claimed.done) {
      const event = claimed.done;
      const previousAction = typeof event.payload.action === "string"
        ? event.payload.action
        : "duplicate";
      return { event, ticketId: event.ticketId, action: previousAction };
    }
    claim = claimed.claim;

    const event = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM itsm_events WHERE id = ${claimed.claim.id} FOR UPDATE`;
      const locked = await tx.itsmEvent.findFirst({ where: { id: claimed.claim.id, connectionId: row.id, teamId: row.teamId, ownerBound: true } });
      if (!locked) throw new ConflictError();
      const receipt = toEventRecord(locked);
      if (receipt.status === "ok" || receipt.status === "ignored") return receipt;
      if (receipt.payload.applied === true) {
        // The side effect already happened on an earlier attempt that then
        // failed to record its outcome: finish the bookkeeping, never repeat it.
        action = typeof receipt.payload.action === "string" ? receipt.payload.action : "acknowledged";
        ticketId = receipt.ticketId;
      } else if (normalized.invalidStatus || (normalized.status && !status)) {
        throw new ValidationError(t("backend.ticket.ticketStatusIsInvalid"));
      } else if (
        (!ticketId || (eventType.includes("create") && !normalized.commentBody)) &&
        config.createOnInbound !== false &&
        normalized.title
      ) {
        const title = normalized.title;
        const created = await createTicket({
          title,
          description: normalized.description || title,
          priority: inboundPriority(normalized.priority, config.defaultPriority),
          category: normalized.category ?? config.defaultCategory,
          createdBy: systemUserId,
          skipItsmFanOut: true,
          session: row.teamId ? { currentTeamId: row.teamId } : undefined,
          db: tx,
        });
        if (normalized.commentBody) await addTicketComment({
          ticketId: created.id, authorId: systemUserId, body: `[ITSM inbound] ${normalized.commentBody}`, skipItsmFanOut: true, db: tx,
        });
        if (status && status !== created.status) await updateTicketStatus({ id: created.id, status, skipItsmFanOut: true, db: tx });
        ticketId = created.id;
        action = "create";
      } else if (ticketId && (normalized.commentBody || status)) {
        const targetId = ticketId;
        await lockTicket(tx, targetId);
        const target = await tx.ticket.findFirst({
          where: { id: targetId, teamId: row.teamId },
          select: { id: true, status: true },
        });
        if (!target) {
          throw new NotFoundError(t("backend.itsm.ticketNotFoundForThisConnectionTeam"));
        }
        let appliedAction = normalized.commentBody ? "comment" : "acknowledged";
        if (normalized.commentBody) {
          await addTicketComment({
            ticketId: targetId, authorId: systemUserId, body: `[ITSM inbound] ${normalized.commentBody}`,
            skipItsmFanOut: true, db: tx,
          });
        }
        // Comment notifications can repeat the ticket's current status.
        if (status && status !== target.status) {
          await updateTicketStatus({ id: targetId, status, skipItsmFanOut: true, db: tx });
          appliedAction = normalized.commentBody ? "comment_status_update" : "status_update";
        }
        action = appliedAction;
      } else if (ticketId) {
        const target = await tx.ticket.findFirst({
          where: { id: ticketId, teamId: row.teamId },
          select: { id: true },
        });
        if (!target) {
          throw new NotFoundError(t("backend.itsm.ticketNotFoundForThisConnectionTeam"));
        }
        action = "acknowledged";
      } else {
        action = "ignored_no_ticket";
      }
      const finalStatus = action.startsWith("ignored") ? "ignored" : "ok";
      const finalPayload = { terminalAtMs: Date.now(), action, title: normalized.title, status: normalized.status, applied: !action.startsWith("ignored"), sourceConnectionId: row.id };
      return toEventRecord(await tx.itsmEvent.update({
        where: { id: claimed.claim.id },
        data: { status: finalStatus, ticketId, payload: finalPayload, errorMessage: null },
      }));
    });
    await prisma.itsmConnection.update({
      where: { id: row.id },
      data: { lastInboundAt: new Date(), lastError: null },
    });
    return { event, ticketId: event.ticketId, action: typeof event.payload.action === "string" ? event.payload.action : action };
  } catch (err) {
    const message = err instanceof Error ? err.message : "inbound processing failed";
    if (claim) {
      // Keep the claim row (and any applied marker) so the sender's retry is
      // processed — and does not repeat a side effect that already happened.
      await prisma.itsmEvent.updateMany({
        where: { id: claim.id, status: { in: ["pending", "error"] } },
        data: { status: "error", errorMessage: message.slice(0, 2000) },
      }).catch((recordError) => logger.error("failed to record inbound event failure", recordError, { connectionId: row.id }));
    } else if (!(err instanceof ConflictError)) {
      await recordEvent({
        connectionId: row.id,
        teamId: row.teamId,
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
