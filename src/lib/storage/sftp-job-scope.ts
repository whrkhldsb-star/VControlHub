import type { Job } from "@prisma/client";
import { z } from "zod";

import { loadJobOwnerSession } from "@/lib/api-token/authorization";
import { prisma } from "@/lib/db";
import { verifiedBearerTokenId } from "@/lib/auth/bearer-token";
import { sessionHasPermission } from "@/lib/auth/authorization";
import type { SessionPayload } from "@/lib/auth/session";
import { seesAllCustomers } from "@/lib/auth/team-scope";
import { ForbiddenError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

export type SftpJob = Pick<Job, "id" | "payload" | "createdBy" | "teamId">;
type SftpPermission = "storage:write" | "storage:manage-node";
type Target = { id: string; teamId: string | null };

const teamIdSchema = z.string().min(1).nullable();
const scopeSchema = z.object({
  userId: z.string().min(1),
  teamId: teamIdSchema,
  apiTokenId: z.string().min(1).nullable(),
  targetTeams: z.record(z.string(), teamIdSchema),
});

const legacyInventorySchema = z.object({
  teamId: z.string().min(1),
  userId: z.never().optional(),
  apiTokenId: z.never().optional(),
  targetTeams: z.never().optional(),
});

export function sftpJobScope(session: SessionPayload, nodes: Target[]) {
  return {
    userId: session.userId,
    apiTokenId: verifiedBearerTokenId(session),
    teamId: session.currentTeamId ?? null,
    targetTeams: Object.fromEntries(nodes.map(node => [node.id, node.teamId])),
  };
}

function invalidScope(): never {
  throw new ForbiddenError(t("backend.storage.sftpJobScopeInvalid"));
}

export function readSftpJobScope(job: SftpJob, nodeIds: string[] | undefined, permission: SftpPermission) {
  if (!job.createdBy || !nodeIds) return invalidScope();
  const parsed = scopeSchema.safeParse(job.payload);
  if (!parsed.success) {
    // Customer-scoped inventory predates the binding, but its enqueue guard
    // required node management, a permission API tokens could not carry.
    // An older sync could have used a revoked token and must be resubmitted.
    const legacy = legacyInventorySchema.safeParse(job.payload);
    if (permission !== "storage:manage-node" || !legacy.success || legacy.data.teamId !== job.teamId) return invalidScope();
    return {
      userId: job.createdBy, teamId: legacy.data.teamId, apiTokenId: null, permission,
      targetTeams: Object.fromEntries(nodeIds.map(id => [id, legacy.data.teamId])),
    };
  }
  const scope = parsed.data;
  const validTargets = nodeIds.every(id =>
    Object.hasOwn(scope.targetTeams, id) && (scope.teamId === null || scope.teamId === scope.targetTeams[id])
  );
  // The sync route records the target's customer on the job row when a
  // platform admin selected all customers. The payload preserves that view.
  const syncNodeId = permission === "storage:write" ? nodeIds[0] : undefined;
  const jobTeamId = scope.teamId ?? (syncNodeId ? scope.targetTeams[syncNodeId] : null);
  if (scope.userId !== job.createdBy || jobTeamId !== job.teamId ||
      Object.keys(scope.targetTeams).length !== nodeIds.length || !validTargets) {
    return invalidScope();
  }
  return { ...scope, permission };
}

export async function requireSftpJobActor(scope: ReturnType<typeof readSftpJobScope>) {
  const { permission } = scope;
  const actor = await loadJobOwnerSession(scope.userId, scope.teamId);
  if (!actor || actor.currentTeamId !== scope.teamId || (scope.teamId === null && !seesAllCustomers(actor))) {
    throw new ForbiddenError(t("backend.execution.ownerInactive"));
  }
  if (!sessionHasPermission(actor, permission)) throw new ForbiddenError(t("backend.execution.permissionRevoked"));
  if (!scope.apiTokenId) return actor;
  if (!scope.teamId) throw new ForbiddenError(t("api.auth.invalidToken"));
  const token = await prisma.apiToken.findFirst({
    where: {
      id: scope.apiTokenId, createdBy: scope.userId, teamId: scope.teamId, revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      scopes: { has: permission },
    },
    select: { id: true },
  });
  if (!token) throw new ForbiddenError(t("api.auth.invalidToken"));
  // The bearer guard limits the request to its declared permission; keep
  // the owner's admin or node-manager role from bypassing path grants here.
  return { ...actor, roles: [], permissions: [permission] };
}

export function assertSftpJobTargets(targetTeams: Record<string, string | null>, nodes: Target[]) {
  if (nodes.length !== Object.keys(targetTeams).length || nodes.some(node => targetTeams[node.id] !== node.teamId)) {
    throw new ForbiddenError(t("backend.storage.sftpJobTargetChanged"));
  }
}
