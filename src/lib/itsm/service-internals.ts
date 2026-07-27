import { Prisma } from "@prisma/client";

import { decrypt, encrypt, isEncrypted } from "@/lib/crypto/service";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/translations";

import type {
  ItsmConnectionConfig,
  ItsmConnectionRecord,
  ItsmCredentials,
  ItsmDirection,
  ItsmEventRecord,
  ItsmEventStatus,
  ItsmProvider,
} from "./types";

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export function parseConfig(raw: Prisma.JsonValue | null | undefined): ItsmConnectionConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as ItsmConnectionConfig;
}

export function encryptCredentials(creds: ItsmCredentials): string {
  return encrypt(JSON.stringify(creds ?? {}));
}

export function decryptCredentials(enc: string): ItsmCredentials {
  if (!enc) return {};
  const plain = isEncrypted(enc) ? decrypt(enc) : enc;
  try {
    const parsed = JSON.parse(plain) as ItsmCredentials;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new ValidationError(t("backend.itsm.storedItsmCredentialsAreCorrupt"));
  }
}

export function toConnectionRecord(row: {
  id: string;
  name: string;
  provider: string;
  direction: string;
  enabled: boolean;
  credentialsEnc: string;
  config: Prisma.JsonValue;
  teamId: string | null;
  lastOutboundAt: Date | null;
  lastInboundAt: Date | null;
  lastError: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ItsmConnectionRecord {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider as ItsmProvider,
    direction: row.direction as ItsmDirection,
    enabled: row.enabled,
    config: parseConfig(row.config),
    hasCredentials: Boolean(row.credentialsEnc),
    teamId: row.teamId,
    lastOutboundAt: iso(row.lastOutboundAt),
    lastInboundAt: iso(row.lastInboundAt),
    lastError: row.lastError,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toEventRecord(row: {
  id: string;
  connectionId: string | null;
  direction: string;
  eventType: string;
  ticketId: string | null;
  status: string;
  externalId: string | null;
  payload: Prisma.JsonValue;
  errorMessage: string | null;
  createdAt: Date;
}): ItsmEventRecord {
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    connectionId: row.connectionId,
    direction: row.direction as ItsmEventRecord["direction"],
    eventType: row.eventType,
    ticketId: row.ticketId,
    status: row.status as ItsmEventStatus,
    externalId: row.externalId,
    payload,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  };
}

export function supportsOutbound(direction: string): boolean {
  return direction === "outbound" || direction === "bidirectional";
}

export function supportsInbound(direction: string): boolean {
  return direction === "inbound" || direction === "bidirectional";
}

export async function recordEvent(input: {
  connectionId: string | null;
  direction: "inbound" | "outbound";
  eventType: string;
  ticketId?: string | null;
  status: ItsmEventStatus;
  externalId?: string | null;
  payload?: Record<string, unknown>;
  errorMessage?: string | null;
}): Promise<ItsmEventRecord> {
  try {
    const row = await prisma.itsmEvent.create({
      data: {
        connectionId: input.connectionId,
        direction: input.direction,
        eventType: input.eventType,
        ticketId: input.ticketId ?? null,
        status: input.status,
        externalId: input.externalId ?? null,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
        errorMessage: input.errorMessage ?? null,
      },
    });
    return toEventRecord(row);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code ?? "")
        : "";
    if (code === "P2002" || err instanceof Prisma.PrismaClientKnownRequestError) {
      const existing = await prisma.itsmEvent.findFirst({
        where: {
          connectionId: input.connectionId,
          externalId: input.externalId ?? undefined,
        },
      });
      if (existing) return toEventRecord(existing);
    }
    throw err;
  }
}
