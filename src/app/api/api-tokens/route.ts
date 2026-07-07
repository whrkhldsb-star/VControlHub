import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ALLOWED_API_TOKEN_SCOPES,
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from "@/lib/api-token/service";
import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { withCacheHeaders, CachePresets } from "@/lib/cache";

import { AuthError } from "@/lib/errors";
import { idQuerySchema, parseSearchParams } from "@/lib/http/parse-search-params";
export const dynamic = "force-dynamic";

const allowedScopes = new Set<string>(ALLOWED_API_TOKEN_SCOPES);

const createTokenSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Token name is required")
    .max(80, "Token name is too long"),
  scopes: z.array(z.string().trim().min(1)).default(["read"]),
  expiresAt: z.string().trim().optional().nullable(),
});

function wantsHtml(request: Request) {
  return request.headers.get("accept")?.includes("text/html") ?? false;
}

async function parseCreateBody(request: Request) {
  const form = await request.formData();
  const scopes = form
    .getAll("scopes")
    .map(String)
    .flatMap((value) => value.split(","));
  return {
    name: String(form.get("name") ?? ""),
    scopes: scopes.length > 0 ? scopes : undefined,
    expiresAt: form.get("expiresAt") ? String(form.get("expiresAt")) : null,
  };
}

function validateScopes(scopes: string[]) {
  const normalized = Array.from(
    new Set(scopes.map((scope) => scope.trim()).filter(Boolean)),
  );
  const invalid = normalized.filter((scope) => !allowedScopes.has(scope));
  if (invalid.length > 0) {
    throw new Error(`Unsupported scope: ${invalid.join(", ")}`);
  }
  return normalized.length > 0 ? normalized : ["read"];
}

function parseExpiresAt(value?: string | null) {
  if (!value) return null;
  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime())) throw new Error("Invalid expiration time format");
  if (expiresAt.getTime() <= Date.now())
    throw new Error("Expiration time must be in the future");
  return expiresAt;
}

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "api-token:manage" },
    async ({ session }) => {
      if (!session)
        throw new AuthError("Unauthorized");
      return withCacheHeaders(
        NextResponse.json({ tokens: await listApiTokens(session.userId) }),
        CachePresets.shortLived,
      );
    },
  );
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const isFormSubmission = contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
  const options = {
    permission: "api-token:manage" as const,
    rateLimit: GENERAL_WRITE_LIMIT,
    errorStatus: 400,
    errorMessage: "Failed to create token",
    ...(isFormSubmission ? {} : { bodySchema: createTokenSchema }),
  };
  return withApiRoute(
    request,
    options,
    async ({ session, body }) => {
      if (!session)
        throw new AuthError("Unauthorized");

      const parsed = isFormSubmission ? createTokenSchema.parse(await parseCreateBody(request)) : body;
      const scopes = validateScopes(parsed.scopes);
      const expiresAt = parseExpiresAt(parsed.expiresAt);
      const result = await createApiToken({
        userId: session.userId,
        name: parsed.name,
        scopes,
        expiresAt,
      });

      auditUserAction(session.userId, "api_token.create", {
        tokenId: result.apiToken.id,
        name: result.apiToken.name,
        tokenPrefix: result.apiToken.tokenPrefix,
        tokenSuffix: result.apiToken.tokenSuffix,
        scopes: result.apiToken.scopes,
        expiresAt: result.apiToken.expiresAt
          ? result.apiToken.expiresAt.toISOString()
          : null,
      });

      if (wantsHtml(request)) {
        return NextResponse.redirect(
          new URL("/api-tokens?created=1", request.url),
          { status: 303 },
        );
      }
      return NextResponse.json(
        { token: result.token, apiToken: result.apiToken },
        { status: 201 },
      );
    },
  );
}

export async function DELETE(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "api-token:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "Operation failed",
    },
    async ({ session }) => {
      if (!session)
        throw new AuthError("Unauthorized");

      const { id } = parseSearchParams(request, idQuerySchema);
      const token = await revokeApiToken({ userId: session.userId, id });
      auditUserAction(session.userId, "api_token.revoke", {
        tokenId: token.id,
        tokenPrefix: token.tokenPrefix,
        tokenSuffix: token.tokenSuffix,
      });
      return NextResponse.json({ token });
    },
  );
}
