import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/translations";
import { createLogger } from "@/lib/logging";

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
    direction: "outbound",
    eventType: "connection.test",
    ticketId: null,
    status: delivery.ok ? "ok" : "error",
    payload: {
      message: payload.description,
      statusCode: delivery.statusCode ?? null,
      responseBody: delivery.responseBody ?? null,
    },
    errorMessage: delivery.ok ? null : delivery.error ?? "delivery failed",
  });
  await prisma.itsmConnection.update({
    where: { id: row.id },
    data: {
      lastOutboundAt: new Date(),
      lastError: delivery.ok ? null : delivery.error ?? "delivery failed",
    },
  });
  return { ok: delivery.ok, event, error: delivery.ok ? undefined : delivery.error };
}

export async function fanOutTicketEvent(input: {
  ticketId: string;
  eventType: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  category?: string | null;
  commentBody?: string;
  teamId?: string | null;
}): Promise<{ sent: number; failed: number }> {
  const connections = await prisma.itsmConnection.findMany({
    where: {
      enabled: true,
      ...(input.teamId
        ? { OR: [{ teamId: input.teamId }, { teamId: null }] }
        : { teamId: null }),
    },
    take: 50,
  });
  let sent = 0;
  let failed = 0;
  for (const row of connections) {
    if (!supportsOutbound(row.direction)) continue;
    const config = parseConfig(row.config);
    const credentials = decryptCredentials(row.credentialsEnc);
    try {
      assertOutboundReady(row.provider as ItsmProvider, config, credentials);
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : "not ready";
      await recordEvent({
        connectionId: row.id,
        direction: "outbound",
        eventType: input.eventType,
        ticketId: input.ticketId,
        status: "error",
        errorMessage: msg,
      });
      await prisma.itsmConnection.update({ where: { id: row.id }, data: { lastError: msg } });
      continue;
    }
    const delivery = await deliverOutbound({
      provider: row.provider as ItsmProvider,
      config,
      credentials,
      payload: {
        ticketId: input.ticketId,
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        category: input.category,
        eventType: input.eventType,
        commentBody: input.commentBody,
      },
    });
    await recordEvent({
      connectionId: row.id,
      direction: "outbound",
      eventType: input.eventType,
      ticketId: input.ticketId,
      status: delivery.ok ? "ok" : "error",
      payload: {
        statusCode: delivery.statusCode ?? null,
        responseBody: delivery.responseBody ?? null,
      },
      errorMessage: delivery.ok ? null : delivery.error ?? "delivery failed",
    });
    await prisma.itsmConnection.update({
      where: { id: row.id },
      data: {
        lastOutboundAt: new Date(),
        lastError: delivery.ok ? null : delivery.error ?? "delivery failed",
      },
    });
    if (delivery.ok) sent += 1;
    else failed += 1;
  }
  if (sent + failed > 0) {
    logger.info("ticket event fan-out complete", {
      ticketId: input.ticketId,
      eventType: input.eventType,
      sent,
      failed,
    });
  }
  return { sent, failed };
}

export async function safeFanOutTicketEvent(
  input: Parameters<typeof fanOutTicketEvent>[0],
): Promise<void> {
  try {
    await fanOutTicketEvent(input);
  } catch (err) {
    logger.error("ticket fan-out failed", err, {
      ticketId: input.ticketId,
      eventType: input.eventType,
    });
  }
}
