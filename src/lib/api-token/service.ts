import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";

const TOKEN_BYTES=32;
const TOKEN_PREFIX="whr_";

export const ALLOWED_API_TOKEN_SCOPES = [
	"read",
	"server:read",
	"storage:read",
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

function normalizeScopes(scopes?: string[]) {
  const normalized = Array.from(
    new Set((scopes ?? ["read"]).map((s) => s.trim()).filter(Boolean)),
  );
  const invalid = normalized.filter((scope) => !isAllowedApiTokenScope(scope));
  if (invalid.length > 0) {
    throw new Error(`不支持的 scope: ${invalid.join(", ")}`);
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
} as const;

export async function createApiToken(input: { userId: string; name: string; scopes?: string[]; expiresAt?: Date | null }) {
  const name = input.name.trim();
  if (!name) throw new Error("Token 名称不能为空");
  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  const tokenHash = hashApiToken(token);
  const record = await prisma.apiToken.create({
    data: {
      name,
      tokenHash,
      tokenPrefix: token.slice(0, 8),
      tokenSuffix: token.slice(-6),
      scopes: normalizeScopes(input.scopes),
      expiresAt: input.expiresAt ?? null,
      createdBy: input.userId,
    },
    select: API_TOKEN_SAFE_SELECT,
  });
  return { token, apiToken: record };
}

export async function listApiTokens(userId: string) {
  return prisma.apiToken.findMany({
    where: { createdBy: userId },
    orderBy: { createdAt: "desc" },
    select: API_TOKEN_SAFE_SELECT,
  });
}

export async function revokeApiToken(input: { userId: string; id: string }) {
  return prisma.apiToken.update({ where: { id: input.id, createdBy: input.userId }, data: { revokedAt: new Date() } });
}

export async function verifyApiToken(token: string) {
  const tokenHash = hashApiToken(token);
  const record = await prisma.apiToken.findUnique({
    where: { tokenHash },
    include: { creator: { select: { id: true, status: true } } },
  });
  if (!record || record.revokedAt) return null;
  if (!record.creator || record.creator.status === "DISABLED") return null;
  if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) return null;
  await prisma.apiToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } });
  return { userId: record.createdBy, scopes: record.scopes, tokenId: record.id };
}
