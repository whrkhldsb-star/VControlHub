import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { resolveSessionPermissions } from "@/lib/auth/identity-templates";
import { getPermissionsFromRoles, type RoleKey } from "@/lib/auth/rbac";
import { assertSessionCredentialBinding, type SessionPayload } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { AuthError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { lockUserRow } from "@/lib/user/row-lock";
import { apiTokenScopeAllowedForSession } from "./authorization";

const TOKEN_BYTES=32;
const TOKEN_PREFIX="whr_";

export const ALLOWED_API_TOKEN_SCOPES = [
  "read",
  "server:read",
  "storage:read",
  "storage:write",
  "storage:delete",
  "health:read",
  "status:read",
  "image:read",
  "image:write",
] as const;
const ALLOWED_API_TOKEN_SCOPE_SET = new Set<string>(ALLOWED_API_TOKEN_SCOPES);

export function isAllowedApiTokenScope(scope: string) {
  return ALLOWED_API_TOKEN_SCOPE_SET.has(scope);
}

export function hashApiToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function normalizeScopes(scopes?: string[]) {
  const normalized = Array.from(
    new Set((scopes ?? ["read"]).map((s) => s.trim()).filter(Boolean)),
  );
  const invalid = normalized.filter((scope) => !isAllowedApiTokenScope(scope));
  if (invalid.length > 0) {
    throw new ValidationError(
      t("backend.api-token.unsupportedScope", { scopes: invalid.join(", ") }),
    );
  }
  return (normalized.length > 0 ? normalized : ["read"]).slice(0, 20);
}

const API_TOKEN_SAFE_SELECT = {
  id: true,
  name: true,
  tokenPrefix: true,
  tokenSuffix: true,
  scopes: true,
  expiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
  teamId: true,
  team: { select: { name: true, slug: true } },
} as const;

export async function createApiToken(input: {
  session: SessionPayload;
  name: string;
  scopes?: string[];
  expiresAt?: Date | null;
}) {
  const name = input.name.trim();
  if (!name) throw new ValidationError(t("backend.api-token.tokenNameIsRequired"));
  const { session } = input;
  const { userId, currentTeamId: teamId } = session;
  if (!teamId) throw new ForbiddenError(t("backend.api-token.activeCustomerRequired"));

  return prisma.$transaction(async (tx) => {
    // Customer deletion locks the team before updating its users' preferences.
    const [team] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM teams WHERE id = ${teamId} AND "deletedAt" IS NULL FOR SHARE`;
    if (!team) throw new ForbiddenError(t("backend.api-token.activeCustomerRequired"));

    await lockUserRow(tx, userId);
    const owner = await tx.user.findUnique({
      where: { id: userId },
      select: {
        passwordHash: true, sessionEpoch: true, status: true, mustChangePassword: true,
      },
    });
    if (!owner || owner.status !== "ACTIVE" || owner.mustChangePassword) {
      throw new AuthError(t("api.auth.sessionExpired"));
    }
    assertSessionCredentialBinding(session, owner);

    // RBAC imports can change the role key independently of its assigned users.
    const [adminGrant] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT r.id FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId"
      WHERE ur."userId" = ${userId} AND r.key = 'admin' FOR SHARE OF ur, r`;
    const roles: RoleKey[] = adminGrant ? ["admin"] : [];
    let identityPermissions: string[] | null = null;
    if (!adminGrant) {
      // Editing a shared template does not touch any user's row.
      const [membership] = await tx.$queryRaw<Array<{ permissions: string[] }>>`
        SELECT template.permissions FROM team_members AS member
        JOIN identity_templates AS template ON template.id = member."identityTemplateId"
        WHERE member."userId" = ${userId} AND member."teamId" = ${teamId}
        FOR SHARE OF member, template`;
      if (!membership) throw new ForbiddenError(t("backend.api-token.activeCustomerRequired"));
      identityPermissions = membership.permissions;
    }
    const permissions = resolveSessionPermissions({ roles, accountPermissions: getPermissionsFromRoles(roles), identityPermissions });
    if (!permissions.includes("api-token:manage")) {
      throw new ForbiddenError(t("apiCopy.insufficient.permissions.37e6815b"));
    }
    const scopes = normalizeScopes(input.scopes);
    const liveSession = { ...session, roles, permissions };
    if (scopes.some((scope) => !apiTokenScopeAllowedForSession(scope, liveSession))) {
      throw new ForbiddenError(t("api.auth.scopeEscalation"));
    }

    const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
    const apiToken = await tx.apiToken.create({
      data: {
        name,
        tokenHash: hashApiToken(token),
        tokenPrefix: token.slice(0, 8),
        tokenSuffix: token.slice(-6),
        scopes,
        expiresAt: input.expiresAt ?? null,
        createdBy: userId,
        teamId,
      },
      select: API_TOKEN_SAFE_SELECT,
    });
    return { token, apiToken };
  });
}

export type TokenStatus = "all" | "active" | "expired" | "revoked";
type TokenPageOptions = { pageSize: number; cursor?: string; status?: TokenStatus };

function tokenStatusWhere(status: TokenStatus, now: Date): Prisma.ApiTokenWhereInput {
  if (status === "active") return { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
  if (status === "expired") return { revokedAt: null, expiresAt: { lte: now } };
  return status === "revoked" ? { revokedAt: { not: null } } : {};
}

function tokenRows(userId: string, take: number, cursor?: string, status?: Prisma.ApiTokenWhereInput) {
  return prisma.apiToken.findMany({
    where: { createdBy: userId, ...status }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take,
    ...(cursor ? { cursor: { id: cursor, createdBy: userId }, skip: 1 } : {}),
    select: API_TOKEN_SAFE_SELECT,
  });
}

export async function listApiTokenPage(userId: string, { pageSize, cursor, status = "all" }: TokenPageOptions) {
  const now = new Date();
  const owner = { createdBy: userId };
  const where = tokenStatusWhere(status, now);
  const [rows, totalTokens, activeTokens, filteredCount] = await prisma.$transaction([
    tokenRows(userId, pageSize + 1, cursor, where),
    prisma.apiToken.count({ where: owner }),
    prisma.apiToken.count({ where: { ...owner, ...tokenStatusWhere("active", now) } }),
    ...(status === "expired" || status === "revoked" ? [prisma.apiToken.count({ where: { ...owner, ...where } })] : []),
  ], { isolationLevel: "RepeatableRead" });
  const tokens = rows.slice(0, pageSize);
  const total = filteredCount ?? (status === "active" ? activeTokens : totalTokens);
  return { tokens, total, totalTokens, activeTokens, nextCursor: rows.length > pageSize ? tokens.at(-1)!.id : null };
}

export async function revokeApiToken(input: { userId: string; id: string }) {
  const owned = { id: input.id, createdBy: input.userId };
  return prisma.$transaction(async (tx) => {
    const changed = await tx.apiToken.updateMany({ where: { ...owned, revokedAt: null }, data: { revokedAt: new Date() } });
    const token = await tx.apiToken.findUnique({ where: owned, select: API_TOKEN_SAFE_SELECT });
    if (!token) throw new NotFoundError(t("backend.api-token.tokenNotFound"));
    if (changed.count) {
      await writeAuditLog({
        actorType: "USER", actorId: input.userId, action: "api_token.revoke", teamId: token.teamId,
        detail: { tokenId: token.id, tokenPrefix: token.tokenPrefix, tokenSuffix: token.tokenSuffix },
      }, tx);
    }
    return token;
  });
}

/** Skip lastUsedAt writes when the token was already marked used within this window. */
const LAST_USED_AT_TOUCH_MIN_MS = 5 * 60 * 1000;

export async function verifyApiToken(token: string) {
  const tokenHash = hashApiToken(token);
  const record = await prisma.apiToken.findUnique({
    where: { tokenHash },
    include: { creator: { select: { id: true, status: true } } },
  });
  if (!record || record.revokedAt || !record.teamId) return null;
  if (!record.creator || record.creator.status === "DISABLED") return null;
  if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) return null;
  const lastUsedMs = record.lastUsedAt?.getTime() ?? 0;
  if (Date.now() - lastUsedMs >= LAST_USED_AT_TOUCH_MIN_MS) {
    await prisma.apiToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } });
  }
  return { userId: record.createdBy, teamId: record.teamId, scopes: record.scopes, tokenId: record.id };
}
