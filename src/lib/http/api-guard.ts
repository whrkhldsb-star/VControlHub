import { apiCopy } from "@/lib/i18n/api-copy";
import type { z } from "zod";
import { randomUUID } from "node:crypto";

import type { SessionPayload } from "@/lib/auth/session";
import type { Permission } from "@/lib/auth/rbac";
import { requireApiPermission } from "@/lib/auth/require-api-permission";
import { requireApiSession, isSessionPayload } from "@/lib/auth/api-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import {
  authenticateBearerForPermissions,
  hasBearerAuthorization,
} from "@/lib/auth/bearer-token";
import { ValidationError } from "@/lib/errors";
import { apiCatch, apiError } from "@/lib/http/api-error";
import { searchParamsToObject, zodIssueDetails } from "@/lib/http/parse-search-params";
import { type RateLimitConfig, rateLimitResponse, withRateLimit } from "@/lib/http/rate-limit-presets";
import { createLogger } from "@/lib/logging";
import { t } from "@/lib/i18n/service-translations";
import { localizeApiCopy, withApiCopyLocale, type Locale } from "@/lib/i18n/api-copy";
import {
  readRequestBodyBuffer,
  RequestBodyTooLargeError,
} from "@/lib/http/request-body";

const apiLogger = createLogger("api");

/** Default max JSON body size when bodySchema is used (DoS / memory guard). */
export const DEFAULT_MAX_JSON_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB

export type ApiGuardOptions = {
  request: Request;
  permission?: Permission;
  rateLimit?: RateLimitConfig;
};

/**
 * Options for {@link withApiRoute}.
 *
 * TR-037: `bodySchema` and `querySchema` provide declarative zod-driven
 * validation. When a schema is supplied, the request body / query is parsed
 * with `safeParse` *before* the handler runs. On parse failure the route
 * short-circuits with a unified ValidationError (→ 400 + TR-034 envelope:
 * `{ error: "VALIDATION_FAILED", message, code, details }`). On success the
 * parsed value is forwarded to the handler via `context.body` / `context.query`.
 *
 * Schemas are typed with `z.ZodType<T>` rather than `z.AnyZodObject` so
 * routes are free to use unions, discriminated unions, intersections, or
 * non-object roots (e.g. arrays) — anything zod can parse.
 */
export type ApiRouteOptions<TBody = unknown, TQuery = unknown> = {
  /** Single required permission (declarative). */
  permission?: Permission;
  /**
   * Any-of permissions: authenticated session must hold at least one.
   * Prefer over requireAuth + manual sessionHasPermission for multi-perm routes.
   * Mutually exclusive with `permission` (if both set, `permission` wins first).
   */
  permissions?: Permission[];
  /**
   * Authenticated session only (no permission key).
   * Use for self-scoped surfaces: preferences, 2FA, notifications, team switch.
   */
  requireAuth?: boolean;
  rateLimit?: RateLimitConfig;
  errorStatus?: number;
  errorMessage?: string;
  onError?: (error: unknown) => Response;
  bodySchema?: z.ZodType<TBody>;
  /**
   * Max raw body bytes when `bodySchema` is set. Rejects oversized Content-Length
   * early and re-checks after `text()`. Defaults to {@link DEFAULT_MAX_JSON_BODY_BYTES}.
   */
  maxBodyBytes?: number;
  querySchema?: z.ZodType<TQuery>;
};

export type ApiRouteContext<TBody = unknown, TQuery = unknown> = {
  session: SessionPayload | null;
  body: TBody;
  query: TQuery;
  requestId: string;
};

/**
 * Context for routes that declare `permission` / `permissions` / `requireAuth`:
 * the guard rejects unauthenticated requests before the handler runs, so
 * `session` is always present — handlers no longer need dead `if (!session)`
 * guards (which used to be copy-pasted into nearly every route).
 */
export type AuthedApiRouteContext<TBody = unknown, TQuery = unknown> = {
  session: SessionPayload;
  body: TBody;
  query: TQuery;
  requestId: string;
};

/** Options subset that guarantees an authenticated handler context. */
type AuthedRouteOptions<TBody, TQuery> =
  | (ApiRouteOptions<TBody, TQuery> & { permission: Permission })
  | (ApiRouteOptions<TBody, TQuery> & { permissions: Permission[] })
  | (ApiRouteOptions<TBody, TQuery> & { requireAuth: true });

function attachRequestId(response: Response, requestId: string, durationMs?: number) {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  if (durationMs !== undefined) headers.set("Server-Timing", `api;dur=${durationMs.toFixed(1)}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function enforceApiGuard(options: ApiGuardOptions): Promise<Response | SessionPayload | null> {
  const { request, permission, rateLimit } = options;

  if (rateLimit) {
    const rl = await withRateLimit(request, rateLimit);
    if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
  }

  if (!permission) return null;

  if (hasBearerAuthorization(request)) {
    const authenticated = await authenticateBearerForPermissions(request, [permission]);
    if (!authenticated || authenticated instanceof Response) {
      return authenticated ?? apiError({ code: "AUTH_REQUIRED", message: t("api.auth.invalidToken"), status: 401 });
    }
    return authenticated.session;
  }

  const result = await requireApiPermission(permission);
  if (result instanceof Response) return result;
  return result.session;
}

/**
 * Decide whether a request can carry a JSON body. We only attempt to read
 * the body for methods that conventionally have one — GET / HEAD / DELETE
 * with no Content-Type are passed through with `body = undefined`, which
 * any schema authoring `z.undefined()` or `.optional()` can accept.
 */
function methodMayHaveBody(method: string): boolean {
  const m = method.toUpperCase();
  return m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
}

export function requestLocale(request: Request): Locale {
  const cookie = request.headers?.get?.("cookie") ?? "";
  if (/(?:^|;\s*)vps-locale=en(?:;|$)/.test(cookie)) return "en";
  if (/(?:^|;\s*)vps-locale=zh(?:;|$)/.test(cookie) || /^zh(?:-|$)/i.test(request.headers?.get?.("accept-language") ?? "")) return "zh";
  return "en";
}

export async function withApiRoute<TBody = unknown, TQuery = unknown>(
	request: Request,
	options: AuthedRouteOptions<TBody, TQuery>,
	handler: (context: AuthedApiRouteContext<TBody, TQuery>) => Promise<Response>,
): Promise<Response>;
export async function withApiRoute<TBody = unknown, TQuery = unknown>(
	request: Request,
	options: AuthedRouteOptions<TBody, TQuery>,
	handler: (context: AuthedApiRouteContext<TBody, TQuery>) => Promise<Response>,
): Promise<Response>;
export async function withApiRoute<TBody = unknown, TQuery = unknown>(
	request: Request,
	options: ApiRouteOptions<TBody, TQuery>,
	handler: (context: ApiRouteContext<TBody, TQuery>) => Promise<Response>,
): Promise<Response>;
export async function withApiRoute(
	request: Request,
	options: ApiRouteOptions<unknown, unknown>,
	handler: (context: never) => Promise<Response>,
): Promise<Response> {
	const locale = requestLocale(request);
	return withApiCopyLocale(locale, () => runApiRoute(
		request,
		{ ...options, errorMessage: options.errorMessage ? localizeApiCopy(options.errorMessage, locale) : options.errorMessage },
		handler as unknown as (context: ApiRouteContext<unknown, unknown>) => Promise<Response>,
	));
}

async function runApiRoute<TBody = unknown, TQuery = unknown>(
  request: Request,
  options: ApiRouteOptions<TBody, TQuery>,
  handler: (context: ApiRouteContext<TBody, TQuery>) => Promise<Response>,
): Promise<Response> {
  const incomingRequestId = request.headers?.get?.("x-request-id")?.trim();
  const requestId = incomingRequestId && /^[a-zA-Z0-9._:-]{1,128}$/.test(incomingRequestId) ? incomingRequestId : randomUUID();
  const startTime = performance.now();
  const method = request.method;
  const path = (() => { try { return new URL(request.url).pathname; } catch { return request.url; } })();
  try {
    const guard = await enforceApiGuard({ request, permission: options.permission, rateLimit: options.rateLimit });
    if (guard instanceof Response) {
      const dur = performance.now() - startTime;
      apiLogger.info("request rejected", { method, path, status: guard.status, durationMs: Math.round(dur), requestId });
      return attachRequestId(guard, requestId, dur);
    }

    let session = guard;
    if (!session && options.permissions && options.permissions.length > 0) {
      if (hasBearerAuthorization(request)) {
        const authenticated = await authenticateBearerForPermissions(request, options.permissions);
        if (!authenticated || authenticated instanceof Response) {
          const dur = performance.now() - startTime;
          const rejected = authenticated ?? apiError({ code: "AUTH_REQUIRED", message: t("api.auth.invalidToken"), status: 401 });
          apiLogger.info("request token rejected", { method, path, status: rejected.status, durationMs: Math.round(dur), requestId });
          return attachRequestId(rejected, requestId, dur);
        }
        session = authenticated.session;
      }
    }
    if (!session && options.permissions && options.permissions.length > 0) {
      const apiSession = await requireApiSession();
      if (apiSession instanceof Response || !isSessionPayload(apiSession)) {
        const dur = performance.now() - startTime;
        const rejected = apiSession instanceof Response
          ? apiSession
          : apiError({ code: "AUTH_REQUIRED", message: apiCopy("apiCopy.not.authenticated.76d1efbe"), status: 401 });
        apiLogger.info("request auth rejected", { method, path, status: rejected.status, durationMs: Math.round(dur), requestId });
        return attachRequestId(rejected, requestId, dur);
      }
      const ok = options.permissions.some((perm) => sessionHasPermission(apiSession, perm));
      if (!ok) {
        const dur = performance.now() - startTime;
        apiLogger.info("request permission rejected", { method, path, status: 403, durationMs: Math.round(dur), requestId });
        return attachRequestId(
          apiError({ code: "FORBIDDEN", message: apiCopy("apiCopy.insufficient.permissions.37e6815b"), status: 403 }),
          requestId,
          dur,
        );
      }
      session = apiSession;
    } else if (!session && options.requireAuth) {
      if (hasBearerAuthorization(request)) {
        const dur = performance.now() - startTime;
        const rejected = apiError({ code: "FORBIDDEN", message: t("api.auth.invalidToken"), status: 403 });
        return attachRequestId(rejected, requestId, dur);
      }
      const apiSession = await requireApiSession();
      if (apiSession instanceof Response) {
        const dur = performance.now() - startTime;
        apiLogger.info("request auth rejected", { method, path, status: apiSession.status, durationMs: Math.round(dur), requestId });
        return attachRequestId(apiSession, requestId, dur);
      }
      session = apiSession;
    }

    /* ── TR-037: declarative request validation ───────────────── */

    let body: TBody = undefined as TBody;
    if (options.bodySchema) {
      let raw: unknown = undefined;
      if (methodMayHaveBody(request.method)) {
        const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_JSON_BODY_BYTES;
        const contentLengthHeader = request.headers.get("content-length");
        if (contentLengthHeader) {
          const declared = Number(contentLengthHeader);
          if (Number.isFinite(declared) && declared > maxBodyBytes) {
            throw new ValidationError(apiCopy("apiCopy.request.body.too.large.c49c1143"), {
              field: "body",
              maxBodyBytes,
            });
          }
        }
        try {
          // Stream the body through a hard byte limit. This also bounds
          // chunked requests that do not declare Content-Length.
          const text = (await readRequestBodyBuffer(request, maxBodyBytes)).toString("utf8");
          raw = text.length === 0 ? undefined : JSON.parse(text);
        } catch (err) {
          if (err instanceof RequestBodyTooLargeError) {
            throw new ValidationError(apiCopy("apiCopy.request.body.too.large.c49c1143"), {
              field: "body",
              maxBodyBytes,
            });
          }
          if (err instanceof ValidationError) throw err;
          throw new ValidationError(apiCopy("apiCopy.request.body.is.not.valid.json.a7ac0ee3"), { field: "body" });
        }
      }
      const parsed = options.bodySchema.safeParse(raw);
      if (!parsed.success) {
        const { summary, issues } = zodIssueDetails(parsed.error, "body");
        throw new ValidationError(summary, { field: "body", issues });
      }
      body = parsed.data;
    }

    let query: TQuery = undefined as TQuery;
    if (options.querySchema) {
      const url = new URL(request.url);
      const obj = searchParamsToObject(url.searchParams);
      const parsed = options.querySchema.safeParse(obj);
      if (!parsed.success) {
        const { summary, issues } = zodIssueDetails(parsed.error, "query");
        throw new ValidationError(summary, { field: "query", issues });
      }
      query = parsed.data;
    }

    const response = await handler({ session, body, query, requestId });
    const durationMs = performance.now() - startTime;
    apiLogger.info("request completed", { method, path, status: response.status, durationMs: Math.round(durationMs), requestId });
    return attachRequestId(response, requestId, durationMs);
  } catch (error) {
    const durationMs = performance.now() - startTime;
    apiLogger.warn("request failed", { method, path, durationMs: Math.round(durationMs), requestId, error: error instanceof Error ? error.message : String(error) });
    if (options.onError) return attachRequestId(options.onError(error), requestId, durationMs);
    return attachRequestId(apiCatch(error, options.errorStatus ?? 500, options.errorMessage ?? "Operation failed"), requestId, durationMs);
  }
}
