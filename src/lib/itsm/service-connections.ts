import { Prisma } from "@prisma/client";

import { sessionHasPermission } from "@/lib/auth/authorization";
import type { SessionPayload } from "@/lib/auth/session";
import { teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { t } from "@/lib/i18n/translations";

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
  ItsmCredentials,
  ItsmEventRecord,
  ItsmProvider,
} from "./types";

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
  if (supportsOutbound(direction)) {
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
    where: session ? teamWhere(session) : {},
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
    where: { id, ...(session ? teamWhere(session) : {}) },
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
    where: { id, ...(session ? teamWhere(session) : {}) },
  });
  if (!existing) throw new NotFoundError(t("backend.itsm.itsmConnectionNotFound"));

  const data: Prisma.ItsmConnectionUpdateInput = {};
  if (parsed.name !== undefined) data.name = parsed.name;
  if (parsed.direction !== undefined) data.direction = parsed.direction;
  if (parsed.enabled !== undefined) data.enabled = parsed.enabled;
  if (parsed.teamId !== undefined && (!session || sessionHasPermission(session, "team:manage"))) {
    data.teamId = parsed.teamId;
  }
  if (parsed.config !== undefined) data.config = parsed.config as Prisma.InputJsonValue;
  let effectiveCredentials: ItsmCredentials = {};
  if (parsed.credentials !== undefined) {
    const prev = decryptCredentials(existing.credentialsEnc);
    effectiveCredentials = { ...prev, ...parsed.credentials };
    data.credentialsEnc = encryptCredentials(effectiveCredentials);
  }

  // Re-validate outbound readiness after the update: a connection flipped to
  // outbound (or whose credentials/config changed) must not pass validation
  // only to fail at delivery time.
  const finalDirection = parsed.direction ?? existing.direction;
  if (supportsOutbound(finalDirection)) {
    const effectiveConfig = (parsed.config ?? parseConfig(existing.config)) as ItsmConnectionConfig;
    if (parsed.credentials === undefined) {
      effectiveCredentials = decryptCredentials(existing.credentialsEnc);
    }
    assertOutboundReady(existing.provider as ItsmProvider, effectiveConfig, effectiveCredentials);
  }

  const row = await prisma.itsmConnection.update({ where: { id }, data });
  return toConnectionRecord(row);
}

export async function deleteItsmConnection(
  id: string,
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
): Promise<void> {
  const deleted = await prisma.itsmConnection.deleteMany({
    where: { id, ...(session ? teamWhere(session) : {}) },
  });
  if (deleted.count === 0) throw new NotFoundError(t("backend.itsm.itsmConnectionNotFound"));
}

export async function listItsmEvents(input?: {
  connectionId?: string;
  ticketId?: string;
  limit?: number;
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;
}): Promise<ItsmEventRecord[]> {
  const teamFilter = input?.session ? teamWhere(input.session) : {};
  const rows = await prisma.itsmEvent.findMany({
    where: {
      ...(input?.connectionId ? { connectionId: input.connectionId } : {}),
      ...(input?.ticketId ? { ticketId: input.ticketId } : {}),
      ...(Object.keys(teamFilter).length > 0 ? { connection: teamFilter } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(input?.limit ?? 100, 200),
  });
  return rows.map(toEventRecord);
}
