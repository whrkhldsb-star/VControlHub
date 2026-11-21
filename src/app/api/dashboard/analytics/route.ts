/**
 * Dashboard analytics API — chart data for the main dashboard.
 * GET /api/dashboard/analytics?type=servers|downloads|audit|image-bed
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { requestLocale, withApiRoute } from "@/lib/http/api-guard";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { serverTeamWhere, seesAllCustomers, imageTeamWhere, liveCustomerRowsWhere } from "@/lib/auth/team-scope";
import { dailyAuditActivity, hourlyServerUsage } from "@/lib/dashboard/analytics-queries";
import { downloadSummary } from "@/lib/dashboard/download-summary";
import { hasBearerAuthorization } from "@/lib/auth/bearer-token";
import { prisma } from "@/lib/db";
import { parseSearchParams } from "@/lib/http/parse-search-params";

import { apiError } from "@/lib/http/api-error";
import { CachePresets, withCacheHeaders } from "@/lib/cache";
import { GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";
import type { SessionPayload } from "@/lib/auth/session";
import { t } from "@/lib/i18n/service-translations";
import { appTimeZoneDateKey } from "@/lib/datetime/time-zone";

export const dynamic = "force-dynamic";

const ANALYTICS_DOMAINS = ["servers", "downloads", "audit", "image-bed"] as const;
type AnalyticsDomain = (typeof ANALYTICS_DOMAINS)[number];
const ANALYTICS_DOMAIN_SET = new Set<string>(ANALYTICS_DOMAINS);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const ANALYTICS_PAGE_SIZE = 5000;

/**
 * Pages through the week's download tasks and image uploads: small tables.
 * Metric snapshots and audit rows are grouped in PostgreSQL instead
 * (`@/lib/dashboard/analytics-queries`).
 */
async function forEachAnalyticsPage<T extends { id: string }>(
  fetchPage: (cursor?: string) => Promise<T[]>,
  consume: (row: T) => void,
) {
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    for (const row of page) consume(row);
    if (page.length < ANALYTICS_PAGE_SIZE) return;
    const nextCursor = page.at(-1)?.id;
    if (!nextCursor || nextCursor === cursor) {
      throw new Error("Analytics pagination did not advance");
    }
    cursor = nextCursor;
  }
}

/** The application-time-zone day an event belongs to (UTC filed 00:00-08:00 Beijing under the day before). */
function appDayKey(value: Date) {
  return appTimeZoneDateKey(value);
}

function canReadAnalyticsDomain(session: SessionPayload, type: AnalyticsDomain) {
  if (type === "servers") return sessionHasPermission(session, "server:read") || sessionHasPermission(session, "health:read");
  if (type === "downloads") return sessionHasPermission(session, "storage:read");
  if (type === "audit") return sessionHasPermission(session, "audit:read");
  if (type === "image-bed") return sessionHasPermission(session, "image:read");
  return false;
}

function isAnalyticsDomain(value: string): value is AnalyticsDomain {
  return ANALYTICS_DOMAIN_SET.has(value);
}

function shouldIncludeAnalytics(session: SessionPayload, requested: string, type: AnalyticsDomain) {
  return (requested === "all" || requested === type) && canReadAnalyticsDomain(session, type);
}

function requestedDomainForbidden(session: SessionPayload, requested: string) {
  if (requested === "all") return false;
  if (!isAnalyticsDomain(requested)) return false;
  return !canReadAnalyticsDomain(session, requested);
}

export async function GET(request: Request) {
  return withApiRoute(request, {
    requireAuth: true,
    rateLimit: GENERAL_READ_LIMIT,
    // Guard's default catch path (apiCatch + logging) covers this; the
    // errorMessage keeps the route-specific fallback copy for 5xx bodies.
    errorMessage: t("backend.dashboard.analyticsFetchFailed", await requestLocale(request)),
  }, async ({ session }) => {
    const { type } = parseSearchParams(
      request,
      z.object({
        type: z.string().trim().min(1).default("all"),
      }),
    );

    if (requestedDomainForbidden(session, type)) {
      return apiError({ code: "FORBIDDEN", message: t("backend.dashboard.analyticsPermissionDenied"), status: 403 });
    }

    const results: Record<string, unknown> = {};

    // Server metrics trend (last 24h). Metric snapshots derive from Servers (a
    // security root): the servers are chosen with the strict server filter, so
    // per-server grants apply to their snapshots, and a null-team snapshot (a
    // quarantined legacy server non-admins must not see) never falls under the
    // loose "null is shared" teamWhere used for team-owned resources below.
    if (shouldIncludeAnalytics(session, type, "servers")) {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * HOUR_MS);
      const serverIds = seesAllCustomers(session)
        ? null
        : (await prisma.server.findMany({ where: serverTeamWhere(session), select: { id: true } })).map((server) => server.id);
      results.servers = await hourlyServerUsage(twentyFourHoursAgo, serverIds);
    }

    // Download task trend (last 7 days)
    if (shouldIncludeAnalytics(session, type, "downloads")) {
      const sevenDaysAgo = new Date(Date.now() - 7 * DAY_MS);
      results.downloads = (await downloadSummary(session, sevenDaysAgo)).days;
    }

    // Audit log activity (last 30 days, grouped by day)
    if (shouldIncludeAnalytics(session, type, "audit")) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS);
      const teamId = session.currentTeamId || null;
      results.audit = teamId || seesAllCustomers(session)
        ? await dailyAuditActivity(thirtyDaysAgo, teamId)
        : [];
    }

    // Image bed storage trend (last 7 days)
    if (shouldIncludeAnalytics(session, type, "image-bed")) {
      const sevenDaysAgo = new Date(Date.now() - 7 * DAY_MS);
      const dayBuckets = new Map<string, { count: number; size: number }>();
      const allOwners = !hasBearerAuthorization(request) &&
        (sessionHasPermission(session, "team:manage") || sessionHasPermission(session, "media:manage"));
      await forEachAnalyticsPage(
        (cursor) =>
          prisma.imageUpload.findMany({
            where: {
              createdAt: { gte: sevenDaysAgo },
              ...imageTeamWhere(session),
              ...liveCustomerRowsWhere(),
              ...(allOwners ? {} : { userId: session.userId }),
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: ANALYTICS_PAGE_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: { id: true, sizeBytes: true, createdAt: true },
          }),
        (image) => {
          const day = appDayKey(image.createdAt);
          if (!dayBuckets.has(day)) {
            dayBuckets.set(day, { count: 0, size: 0 });
          }
          const bucket = dayBuckets.get(day)!;
          bucket.count++;
          bucket.size += image.sizeBytes;
        },
      );
      results.imageBed = Array.from(dayBuckets.entries()).map(
        ([date, data]) => ({ date, ...data }),
      );
    }

    return withCacheHeaders(NextResponse.json(results), CachePresets.noStore);
  });
}
