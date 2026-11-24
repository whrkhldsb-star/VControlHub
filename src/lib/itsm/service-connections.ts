import { Prisma } from "@prisma/client";

import { sessionHasPermission } from "@/lib/auth/authorization";
import type { SessionPayload } from "@/lib/auth/session";
import { teamCreateData, seesAllCustomers } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

import { assertOutboundReady } from "./adapters";
import { createItsmConnectionSchema, updateItsmConnectionSchema } from "./schema";
import {
  decryptCredentials,
  encryptCredentials,
  parseConfig,
  supportsOutbound,
  toConnectionRecord,
  toEventRecord,
} from "./service-internals";
import type {
  ItsmConnectionConfig,
  ItsmConnectionRecord,
  ItsmEventRecord,
  ItsmProvider,
} from "./types";

type ConnectionSession = Pick<
  SessionPayload,
  "userId" | "roles" | "currentTeamId"
>;

function connectionScope(session?: ConnectionSession): Record<string, unknown> {
  if (!session || seesAllCustomers(session)) return {};
  if (session.currentTeamId) return { teamId: session.currentTeamId };
  // Legacy unassigned connections are private to their creator. They are not
  // global integrations that every tenant can inspect or mutate.
  return { teamId: null, createdById: session.userId };
}

function resolveConnectionTeamId(
  session: Pick<SessionPayload, "userId" | "roles" | "currentTeamId"> | null | undefined,
  bodyTeamId: string | null | undefined,
): string | null {
  if (session && sessionHasPermission(session, "team:manage") && bodyTeamId !== undefined) {
    return bodyTeamId;
  }
  if (session) {
    const fromSession = teamCreateData(session).teamId;
    return fromSession !== undefined ? fromSession : null;
  }
  return bodyTeamId !== undefined ? bodyTeamId : null;
}

export async function createItsmConnection(
  input: unknown,
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId"> | null,
): Promise<ItsmConnectionRecord> {
  const parsed = createItsmConnectionSchema.parse(input);
  const direction = parsed.direction ?? "bidirectional";
  const config = (parsed.config ?? {}) as ItsmConnectionConfig;
  const credentials = parsed.credentials ?? {};
  if (parsed.enabled !== false && supportsOutbound(direction)) {
    assertOutboundReady(parsed.provider, config, credentials);
  }
  const teamId = resolveConnectionTeamId(session, parsed.teamId);
  const row = await prisma.itsmConnection.create({
    data: {
      name: parsed.name,
      provider: parsed.provider,
      direction,
      enabled: parsed.enabled ?? true,
      credentialsEnc: encryptCredentials(credentials),
      config: config as Prisma.InputJsonValue,
      teamId,
      createdById: session?.userId ?? null,
    },
  });
  return toConnectionRecord(row);
}

export async function listItsmConnections(
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
): Promise<ItsmConnectionRecord[]> {
  const rows = await prisma.itsmConnection.findMany({
    where: connectionScope(session),
    orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });
  return rows.map(toConnectionRecord);
}

export async function getItsmConnection(
  id: string,
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
): Promise<ItsmConnectionRecord> {
  const row = await prisma.itsmConnection.findFirst({
    where: { id, ...connectionScope(session) },
  });
  if (!row) throw new NotFoundError(t("backend.itsm.itsmConnectionNotFound"));
  return toConnectionRecord(row);
}

export async function updateItsmConnection(
  id: string,
  input: unknown,
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
): Promise<ItsmConnectionRecord> {
  const parsed = updateItsmConnectionSchema.parse(input);
  const existing = await prisma.itsmConnection.findFirst({
    where: { id, ...connectionScope(session) },
  });
  if (!existing) throw new NotFoundError(t("backend.itsm.itsmConnectionNotFound"));

  const data: Prisma.ItsmConnectionUpdateManyMutationInput = {};
  if (parsed.name !== undefined) data.name = parsed.name;
  if (parsed.direction !== undefined) data.direction = parsed.direction;
  if (parsed.enabled !== undefined) data.enabled = parsed.enabled;
  if (parsed.teamId !== undefined && (!session || sessionHasPermission(session, "team:manage"))) {
    if (parsed.teamId !== existing.teamId) throw new ValidationError(t("backend.itsm.newConnectionForCustomer"));
  }
  if (parsed.config !== undefined) {
    // Repointing a connection's webhook URL without explicitly re-entering stored
    // credentials would forward the existing Bearer accessToken / webhookSecret to
    // a new host (even if credentials: {} is passed or webhookUrl was cleared first).
    const prevConfig = parseConfig(existing.config);
    const prevUrl = typeof prevConfig.webhookUrl === "string" ? prevConfig.webhookUrl.trim() : "";
    const nextUrl = typeof parsed.config.webhookUrl === "string" ? parsed.config.webhookUrl.trim() : "";
    if (nextUrl && nextUrl !== prevUrl) {
      const existingCreds = decryptCredentials(existing.credentialsEnc);
      const nextCreds = parsed.credentials;
      const missingAccessToken = Boolean(existingCreds.accessToken) && !nextCreds?.accessToken;
      const missingWebhookSecret = Boolean(existingCreds.webhookSecret) && !nextCreds?.webhookSecret;
      if (missingAccessToken || missingWebhookSecret) {
        throw new ValidationError(t("backend.itsm.webhookCredentialsRequiredOnUrlChange"));
      }
    }
    data.config = parsed.config as Prisma.InputJsonValue;
  }
  const enabled = parsed.enabled ?? existing.enabled;
  if (enabled || parsed.credentials !== undefined) {
    const credentials = { ...decryptCredentials(existing.credentialsEnc), ...parsed.credentials };
    if (parsed.credentials !== undefined) data.credentialsEnc = encryptCredentials(credentials);
    if (enabled) {
      const direction = parsed.direction ?? existing.direction;
      const config = parsed.config ?? parseConfig(existing.config);
      // Older generic connections used the provider spelling "webhook".
      const provider = existing.provider === "webhook" ? "generic_webhook" : existing.provider;
      createItsmConnectionSchema.parse({ name: parsed.name ?? existing.name, provider, direction, credentials, config });
      if (supportsOutbound(direction)) assertOutboundReady(provider as ItsmProvider, config, credentials);
    }
  }

  const updated = await prisma.itsmConnection.updateMany({
    where: { ...connectionScope(session), id, teamId: existing.teamId, updatedAt: existing.updatedAt },
    data,
  });
  if (updated.count === 0)
    throw new NotFoundError(t("backend.itsm.itsmConnectionNotFound"));
  const row = await prisma.itsmConnection.findUnique({ where: { id } });
  if (!row) throw new NotFoundError(t("backend.itsm.itsmConnectionNotFound"));
  return toConnectionRecord(row);
}

export async function deleteItsmConnection(
  id: string,
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
): Promise<void> {
  const deleted = await prisma.itsmConnection.deleteMany({
    where: { id, ...connectionScope(session) },
  });
  if (deleted.count === 0) throw new NotFoundError(t("backend.itsm.itsmConnectionNotFound"));
}

export async function listItsmEvents(input?: {
  connectionId?: string;
  ticketId?: string;
  limit?: number;
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;
}): Promise<ItsmEventRecord[]> {
  const session = input?.session;
  const owner = !session || seesAllCustomers(session) ? {} : {
    ownerBound: true,
    teamId: session.currentTeamId ?? null,
    ...(!session.currentTeamId ? { connection: connectionScope(session) } : {}),
  };
  const rows = await prisma.itsmEvent.findMany({
    where: {
      ...(input?.connectionId ? { connectionId: input.connectionId } : {}),
      ...(input?.ticketId ? { ticketId: input.ticketId } : {}),
      ...owner,
    },
    orderBy: { createdAt: "desc" },
    // Clamped and truncated here too: `take` rejects a fractional row count, and a
    // negative one silently pages backwards from the oldest end. The HTTP route
    // validates its query, but server components call this directly.
    take: Math.min(Math.max(Math.trunc(input?.limit ?? 100), 1), 200),
  });
  return rows.map(toEventRecord);
}
