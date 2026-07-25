import type { z } from "zod";
import { randomUUID } from "node:crypto";

import type { SessionPayload } from "@/lib/auth/session";
import type { Permission } from "@/lib/auth/rbac";
import { requireApiPermission } from "@/lib/auth/require-api-permission";
import { requireApiSession, isSessionPayload } from "@/lib/auth/api-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { ValidationError } from "@/lib/errors";
import { apiCatch, apiError } from "@/lib/http/api-error";
import { searchParamsToObject, zodIssueDetails } from "@/lib/http/parse-search-params";
import { type RateLimitConfig, rateLimitResponse, withRateLimit } from "@/lib/http/rate-limit-presets";
import { createLogger } from "@/lib/logging";

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

export async function withApiRoute<TBody = unknown, TQuery = unknown>(
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
      const apiSession = await requireApiSession();
      if (apiSession instanceof Response || !isSessionPayload(apiSession)) {
        const dur = performance.now() - startTime;
        const rejected = apiSession instanceof Response
          ? apiSession
          : apiError({ code: "AUTH_REQUIRED", message: "Not authenticated", status: 401 });
        apiLogger.info("request auth rejected", { method, path, status: rejected.status, durationMs: Math.round(dur), requestId });
        return attachRequestId(rejected, requestId, dur);
      }
      const ok = options.permissions.some((perm) => sessionHasPermission(apiSession, perm));
      if (!ok) {
        const dur = performance.now() - startTime;
        apiLogger.info("request permission rejected", { method, path, status: 403, durationMs: Math.round(dur), requestId });
        return attachRequestId(
          apiError({ code: "FORBIDDEN", message: "Insufficient permissions", status: 403 }),
          requestId,
          dur,
        );
      }
      session = apiSession;
    } else if (!session && options.requireAuth) {
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
            throw new ValidationError("Request body too large", {
              field: "body",
              maxBodyBytes,
            });
          }
        }
        try {
          // .json() on an empty body throws; treat that as undefined so the
          // schema decides whether undefined is acceptable.
          const text = await request.clone().text();
          if (Buffer.byteLength(text, "utf8") > maxBodyBytes) {
            throw new ValidationError("Request body too large", {
              field: "body",
              maxBodyBytes,
            });
          }
          raw = text.length === 0 ? undefined : JSON.parse(text);
        } catch (err) {
          if (err instanceof ValidationError) throw err;
          throw new ValidationError("Request body is not valid JSON", { field: "body" });
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
