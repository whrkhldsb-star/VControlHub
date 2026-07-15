import type { z } from "zod";
import { randomUUID } from "node:crypto";

import type { SessionPayload } from "@/lib/auth/session";
import type { Permission } from "@/lib/auth/rbac";
import { requireApiPermission } from "@/lib/auth/require-api-permission";
import { requireApiSession } from "@/lib/auth/api-session";
import { ValidationError } from "@/lib/errors";
import { apiCatch } from "@/lib/http/api-error";
import { type RateLimitConfig, rateLimitResponse, withRateLimit } from "@/lib/http/rate-limit-presets";
import { createLogger } from "@/lib/logging";

const apiLogger = createLogger("api");

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
  permission?: Permission;
  requireAuth?: boolean;
  rateLimit?: RateLimitConfig;
  errorStatus?: number;
  errorMessage?: string;
  onError?: (error: unknown) => Response;
  bodySchema?: z.ZodType<TBody>;
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
 * Format a zod ZodError into a single readable message + a structured
 * details object so consumers can render per-field errors.
 *
 * Note: zod 4.x renamed `ZodError.errors` to `.issues`; we accept both.
 */
function zodIssueDetails(err: z.ZodError): { summary: string; issues: Array<{ path: string; message: string }> } {
  // Tolerate older zod that exposed `.errors` instead of `.issues`.
  // `ZodIssue` is the canonical shape on zod 4.x; the cast through unknown
  // lets us read either field without losing typing on the consumer side.
  const rawIssues: ReadonlyArray<{ path?: unknown; message?: unknown }> = (err as unknown as { issues?: ReadonlyArray<{ path?: unknown; message?: unknown }> }).issues
    ?? (err as unknown as { errors?: ReadonlyArray<{ path?: unknown; message?: unknown }> }).errors
    ?? [];
  const items = rawIssues.map((i) => ({
    path: Array.isArray(i.path) ? i.path.join(".") : String(i.path ?? ""),
    message: typeof i.message === "string" ? i.message : "Invalid value",
  }));
  const summary = items.length === 0
    ? "Request body validation failed"
    : items.length === 1
      ? `${items[0]!.path ? items[0]!.path + ": " : ""}${items[0]!.message}`
      : `${items.length} field(s) failed validation: ${items.slice(0, 3).map((i) => i.path || "?").join(", ")}${items.length > 3 ? "…" : ""}`;
  return { summary, issues: items };
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
    if (guard instanceof Response) return attachRequestId(guard, requestId);

    let session = guard;
    if (!session && options.requireAuth) {
      const apiSession = await requireApiSession();
      if (apiSession instanceof Response) return attachRequestId(apiSession, requestId);
      session = apiSession;
    }

    /* ── TR-037: declarative request validation ───────────────── */

    let body: TBody = undefined as TBody;
    if (options.bodySchema) {
      let raw: unknown = undefined;
      if (methodMayHaveBody(request.method)) {
        try {
          // .json() on an empty body throws; treat that as undefined so the
          // schema decides whether undefined is acceptable.
          const text = await request.clone().text();
          raw = text.length === 0 ? undefined : JSON.parse(text);
        } catch {
          throw new ValidationError("Request body is not valid JSON", { field: "body" });
        }
      }
      const parsed = options.bodySchema.safeParse(raw);
      if (!parsed.success) {
        const { summary, issues } = zodIssueDetails(parsed.error);
        throw new ValidationError(summary, { field: "body", issues });
      }
      body = parsed.data;
    }

    let query: TQuery = undefined as TQuery;
    if (options.querySchema) {
      const url = new URL(request.url);
      // Build a plain object from URLSearchParams; for repeated keys keep
      // an array so zod can use z.array(...). Single values stay scalar.
      const obj: Record<string, string | string[]> = {};
      for (const key of new Set(url.searchParams.keys())) {
        const all = url.searchParams.getAll(key);
        obj[key] = all.length > 1 ? all : all[0]!;
      }
      const parsed = options.querySchema.safeParse(obj);
      if (!parsed.success) {
        const { summary, issues } = zodIssueDetails(parsed.error);
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
