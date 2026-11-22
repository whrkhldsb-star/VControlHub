import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createApiToken,
  listApiTokenPage,
  normalizeScopes,
  revokeApiToken,
} from "@/lib/api-token/service";
import { apiTokenScopeAllowedForSession } from "@/lib/api-token/authorization";
import { auditUserAction } from "@/lib/audit/service";
import { requestLocale, withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { withCacheHeaders, CachePresets } from "@/lib/cache";

import { ForbiddenError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { idQuerySchema, parseSearchParams } from "@/lib/http/parse-search-params";
import {
  MAX_NON_FILE_FORM_BYTES,
  requestContentLengthExceeds,
} from "@/lib/http/request-body";
export const dynamic = "force-dynamic";

const createTokenSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Token name is required")
    .max(80, "Token name is too long"),
  scopes: z.array(z.string().trim().min(1)).default(["read"]),
  expiresAt: z.string().trim().optional().nullable(),
});

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

function parseExpiresAt(value?: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  // Prefer absolute ISO-8601 (with Z or ±offset). Bare datetime-local forms are
  // ambiguous across browser vs server TZ and should be normalized client-side.
  const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed);
  if (!hasTimezone) {
    throw new ValidationError(apiCopy("apiCopy.apiTokens.expiryTimezoneRequired"));
  }
  const date = /^(\d{4})-(\d{2})-(\d{2})[Tt ]/.exec(trimmed);
  const year = Number(date?.[1]), month = Number(date?.[2]), day = Number(date?.[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!date || month < 1 || month > 12 || day < 1 || day > days[month - 1]!) {
    throw new ValidationError(apiCopy("apiCopy.apiTokens.expiryInvalidFormat"));
  }
  const expiresAt = new Date(trimmed);
  if (Number.isNaN(expiresAt.getTime())) throw new ValidationError(apiCopy("apiCopy.apiTokens.expiryInvalidFormat"));
  if (expiresAt.getTime() <= Date.now())
    throw new ValidationError(apiCopy("apiCopy.apiTokens.expiryMustBeFuture"));
  return expiresAt;
}

const tokenListQuery = z.object({
  pageSize: z.coerce.number().int().min(1).max(200).default(200),
  cursor: z.string().min(1).optional(),
  status: z.enum(["all", "active", "unbound", "expired", "revoked"]).default("all"),
});

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "api-token:manage", querySchema: tokenListQuery },
    async ({ session, query }) => {
      return withCacheHeaders(
        NextResponse.json(await listApiTokenPage(session.userId, query)),
        CachePresets.noStore,
      );
    },
  );
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const isFormSubmission = contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
  if (isFormSubmission && requestContentLengthExceeds(request, MAX_NON_FILE_FORM_BYTES)) {
    return NextResponse.json({ error: t("backend.request.bodyTooLarge", await requestLocale(request)) }, { status: 413 });
  }
  const options = {
    permission: "api-token:manage" as const,
    rateLimit: GENERAL_WRITE_LIMIT,
    errorStatus: 400,
    errorMessage: apiCopy("apiCopy.failed.to.create.token.f8a44ba9"),
    ...(isFormSubmission ? {} : { bodySchema: createTokenSchema }),
  };
  return withApiRoute(
    request,
    options,
    async ({ session, body }) => {
      const parsed = isFormSubmission ? createTokenSchema.parse(await parseCreateBody(request)) : body;
      const scopes = normalizeScopes(parsed.scopes);
      const unauthorizedScopes = scopes.filter(
        (scope) => !apiTokenScopeAllowedForSession(scope, session),
      );
      if (unauthorizedScopes.length > 0) {
        throw new ForbiddenError(t("api.auth.scopeEscalation"));
      }
      const expiresAt = parseExpiresAt(parsed.expiresAt);
      const result = await createApiToken({
        session,
        name: parsed.name,
        scopes,
        expiresAt,
      });

      await auditUserAction(session.userId, "api_token.create", {
        tokenId: result.apiToken.id,
        name: result.apiToken.name,
        tokenPrefix: result.apiToken.tokenPrefix,
        tokenSuffix: result.apiToken.tokenSuffix,
        scopes: result.apiToken.scopes,
        expiresAt: result.apiToken.expiresAt
          ? result.apiToken.expiresAt.toISOString()
          : null,
      }, undefined, session.currentTeamId);

      // The plaintext token exists only in this response: a form post that
      // redirected to the page could never show it (A1-03), so every caller
      // gets the JSON body.
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
      errorMessage: apiCopy("apiCopy.operation.failed.4e1af7c7"),
    },
    async ({ session }) => {
      const { id } = parseSearchParams(request, idQuerySchema);
      const token = await revokeApiToken({ userId: session.userId, id });
      return NextResponse.json({ token });
    },
  );
}
