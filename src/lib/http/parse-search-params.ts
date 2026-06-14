/**
 * Shared URL search-params parsing helpers (TR-037).
 *
 * Background: many API routes used to inline `new URL(req.url).searchParams`
 * and pull values with `.get(...)`, `.getAll(...)`, or `Number(...)` casts
 * — each of which:
 *
 *   1. missed zod-driven validation (silent `NaN` from `Number(null)`, etc.)
 *   2. didn't surface a unified 400 with field-level details
 *   3. couldn't represent repeated keys (e.g. `?tag=a&tag=b`) consistently
 *   4. forced every route to know the exact key set in advance
 *
 * This helper gives every route the same building block:
 *
 *   const q = parseSearchParams(request, listSchema);
 *   // or:
 *   const obj = searchParamsToObject(request.nextUrl.searchParams);
 *   const parsed = mySchema.safeParse(obj);
 *
 * Behaviour contract:
 *   - Single value for a key → `string`.
 *   - Repeated value for a key → `string[]` (so zod's `z.array(...)` works).
 *   - Unknown keys are kept (zod schema decides what to keep / strip).
 *   - Coercion to number/boolean lives in the schema, not in this helper —
 *     keeps the helper trivially testable and side-effect free.
 */

import { z } from "zod";

/**
 * Materialise a `URLSearchParams` into a plain object suitable for
 * `zod.safeParse`. Mirrors the conversion `withApiRoute` uses for the
 * `querySchema` option, exposed as a standalone helper so ad-hoc call
 * sites (e.g. server actions reading `req.nextUrl.searchParams`) can
 * reuse the exact same shape.
 *
 * - A key with a single value → `string`.
 * - A key with multiple values → `string[]` (preserves order).
 * - Empty values (`?foo=`) become `""` so the schema can decide.
 *
 * The helper never mutates the input and never throws.
 */
export function searchParamsToObject(
  searchParams: URLSearchParams,
): Record<string, string | string[]> {
  const obj: Record<string, string | string[]> = {};
  for (const key of new Set(searchParams.keys())) {
    const all = searchParams.getAll(key);
    obj[key] = all.length > 1 ? all : all[0]!;
  }
  return obj;
}

/**
 * One-call helper: read `request.url`, materialise the query string, and
 * validate it against a zod schema. Returns the parsed (transformed) value.
 *
 * On parse failure, throws the same `ValidationError` shape that
 * `withApiRoute`/`apiCatch` already render — so the wire format stays
 * `{ code: "VALIDATION_FAILED", message, details: { issues: [...] } }`.
 */
export function parseSearchParams<S extends z.ZodTypeAny>(
  request: Request | URL,
  schema: S,
): z.output<S> {
  const url = request instanceof URL ? request : new URL(request.url);
  const raw = searchParamsToObject(url.searchParams);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // Build a {summary, issues} pair using the same convention as
    // `withApiRoute` so a ValidationError thrown from here is
    // indistinguishable from one produced by body/query schema validation.
    const rawIssues: ReadonlyArray<{ path?: unknown; message?: unknown }> =
      (parsed.error as unknown as { issues?: ReadonlyArray<{ path?: unknown; message?: unknown }> }).issues
      ?? (parsed.error as unknown as { errors?: ReadonlyArray<{ path?: unknown; message?: unknown }> }).errors
      ?? [];
    const issues = rawIssues.map((i) => ({
      path: Array.isArray(i.path) ? i.path.join(".") : String(i.path ?? ""),
      message: typeof i.message === "string" ? i.message : "Invalid value",
    }));
    const summary = issues.length === 0
      ? "查询参数校验失败"
      : issues.length === 1
        ? `${issues[0]!.path ? issues[0]!.path + ": " : ""}${issues[0]!.message}`
        : `${issues.length} 个查询参数校验失败：${issues.slice(0, 3).map((i) => i.path || "?").join(", ")}${issues.length > 3 ? "…" : ""}`;
    const err = new Error(summary);
    (err as Error & { code?: string; status?: number; details?: unknown }).code = "VALIDATION_FAILED";
    (err as Error & { code?: string; status?: number; details?: unknown }).status = 400;
    (err as Error & { code?: string; status?: number; details?: unknown }).details = { field: "query", issues };
    throw err;
  }
  return parsed.data;
}

/* ── Reusable query shapes ────────────────────────────────────────────── */

/**
 * Common `page` / `pageSize` / `limit` shape, used by list endpoints
 * (`/api/audit`, `/api/images/list`, `/api/files/list`, ...).
 *
 * - `page`     : 1-based page index, default 1.
 * - `pageSize` : items per page, default 20, capped at 200.
 * - `limit`    : optional explicit cap; if supplied, callers may use it
 *                instead of `pageSize` (e.g. "give me the 30 newest").
 *
 * All inputs arrive as strings (URL query); zod handles coercion.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1, "page 必须 ≥ 1").default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, "pageSize 必须 ≥ 1")
    .max(200, "pageSize 不能超过 200")
    .default(20),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * `id` lookup helper — used by DELETE handlers that take the id from the
 * query string (e.g. `/api/snippets?id=xxx`).
 */
export const idQuerySchema = z.object({
  id: z.string().trim().min(1, "缺少 id"),
});
export type IdQuery = z.infer<typeof idQuerySchema>;

/**
 * Boolean toggle helper — accepts `"1" | "true" | "yes" | "on"` as truthy,
 * anything else as falsy. Avoids ad-hoc `=== "1"` checks scattered across
 * routes.
 */
export const booleanFlagSchema = z
  .union([z.string(), z.boolean(), z.undefined()])
  .transform((v) => {
    if (typeof v === "boolean") return v;
    if (v === undefined) return false;
    return /^(1|true|yes|on)$/i.test(v.trim());
  });
