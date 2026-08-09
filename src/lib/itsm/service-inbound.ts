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

export async function handleInboundWebhook(input: {
  connectionId: string;
  rawBody: string;
  signatureHeader: string | null;
  json: Record<string, unknown>;
  systemUserId: string;
}): Promise<{ event: ItsmEventRecord; ticketId: string | null; action: string }> {
  const row = await prisma.itsmConnection.findUnique({ where: { id: input.connectionId } });
  if (!row) throw new NotFoundError(t("backend.itsm.itsmConnectionNotFound"));
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
  try {
		if (normalized.externalId) {
			const existingEvent = await prisma.itsmEvent.findFirst({
				where: { connectionId: row.id, externalId: normalized.externalId },
				orderBy: { createdAt: "desc" },
			});
			if (existingEvent) {
				const event = toEventRecord(existingEvent);
				const previousAction = typeof event.payload.action === "string"
					? event.payload.action
					: "duplicate";
				return { event, ticketId: event.ticketId, action: previousAction };
			}
		}

    if (normalized.commentBody && ticketId) {
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
      await addTicketComment({
        ticketId,
        authorId: input.systemUserId,
        body: `[ITSM inbound] ${normalized.commentBody}`,
        skipItsmFanOut: true,
      });
      action = "comment";
    } else if (
      (eventType.includes("create") || !ticketId) &&
      config.createOnInbound !== false &&
      normalized.title
    ) {
      const ticket = await createTicket({
        title: normalized.title,
        description: normalized.description || normalized.title,
        priority: normalizePriority(normalized.priority ?? config.defaultPriority),
        category: normalized.category ?? config.defaultCategory,
        createdBy: input.systemUserId,
        skipItsmFanOut: true,
        session: row.teamId ? { currentTeamId: row.teamId } : undefined,
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
        await updateTicketStatus({ id: ticketId, status, skipItsmFanOut: true });
        action = "status_update";
      } else {
        action = "ignored_status";
      }
    } else if (ticketId) {
      action = "acknowledged";
    } else {
      action = "ignored_no_ticket";
    }

    const event = await recordEvent({
      connectionId: row.id,
      direction: "inbound",
      eventType,
      ticketId,
      status: action.startsWith("ignored") ? "ignored" : "ok",
      externalId: normalized.externalId,
      payload: { action, title: normalized.title, status: normalized.status },
    });
    await prisma.itsmConnection.update({
      where: { id: row.id },
      data: { lastInboundAt: new Date(), lastError: null },
    });
    return { event, ticketId, action };
  } catch (err) {
    const message = err instanceof Error ? err.message : "inbound processing failed";
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
