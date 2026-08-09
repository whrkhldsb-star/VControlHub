/**
 * Dashboard analytics API — chart data for the main dashboard.
 * GET /api/dashboard/analytics?type=servers|downloads|audit|image-bed
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { createLogger } from "@/lib/logging";

import { apiError, apiCatch } from "@/lib/http/api-error";
import { CachePresets, withCacheHeaders } from "@/lib/cache";
import { GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";
import type { SessionPayload } from "@/lib/auth/session";
import { t } from "@/lib/i18n/translations";
const logger = createLogger("api:dashboard:analytics");

export const dynamic = "force-dynamic";

const ANALYTICS_DOMAINS = ["servers", "downloads", "audit", "image-bed"] as const;
type AnalyticsDomain = (typeof ANALYTICS_DOMAINS)[number];
const ANALYTICS_DOMAIN_SET = new Set<string>(ANALYTICS_DOMAINS);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const ANALYTICS_PAGE_SIZE = 5000;

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

function startOfUtcHour(value: Date) {
  const hour = new Date(value);
  hour.setMinutes(0, 0, 0);
  return hour.toISOString();
}

function startOfUtcDay(value: Date) {
  return value.toISOString().slice(0, 10);
}

function canReadAnalyticsDomain(session: SessionPayload, type: AnalyticsDomain) {
  if (type === "servers") return sessionHasPermission(session, "server:read") || sessionHasPermission(session, "health:read");
  if (type === "downloads") return sessionHasPermission(session, "storage:read");
  if (type === "audit") return sessionHasPermission(session, "audit:read");
  if (type === "image-bed") return sessionHasPermission(session, "image:read") || sessionHasPermission(session, "image:write") || sessionHasPermission(session, "media:manage");
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
    onError: (error) => {
      logger.error("[dashboard/analytics]", error);
      return apiCatch(error, 500, t("backend.dashboard.analyticsFetchFailed"));
    },
  }, async ({ session }) => {
    if (!session) return NextResponse.json({ error: t("backend.dashboard.notAuthenticated") }, { status: 401 });
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
    const metricTeamFilter = teamWhere(session);
    const resourceTeamFilter = teamWhere(session);

    // Server metrics trend (last 24h). Use denormalized teamId on metric_snapshots
    // so we do not join Server for every snapshot row.
    if (shouldIncludeAnalytics(session, type, "servers")) {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * HOUR_MS);
      const buckets = new Map<
        string,
        { cpu: number; memory: number; disk: number; count: number }
      >();
      await forEachAnalyticsPage(
        (cursor) =>
          prisma.metricSnapshot.findMany({
            where: {
              createdAt: { gte: twentyFourHoursAgo },
              ...metricTeamFilter,
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: ANALYTICS_PAGE_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: {
              id: true,
              cpuUsage: true,
              memUsage: true,
              diskUsage: true,
              createdAt: true,
            },
          }),
        (metric) => {
          const key = startOfUtcHour(metric.createdAt);
          const bucket = buckets.get(key) ?? {
            cpu: 0,
            memory: 0,
            disk: 0,
            count: 0,
          };
          bucket.cpu += metric.cpuUsage;
          bucket.memory += metric.memUsage;
          bucket.disk += metric.diskUsage;
          bucket.count++;
          buckets.set(key, bucket);
        },
      );
      results.servers = Array.from(buckets.entries()).map(([time, data]) => ({
        time,
        cpu: data.count ? Math.round(data.cpu / data.count) : 0,
        memory: data.count ? Math.round(data.memory / data.count) : 0,
        disk: data.count ? Math.round(data.disk / data.count) : 0,
      }));
    }

    // Download task trend (last 7 days)
    if (shouldIncludeAnalytics(session, type, "downloads")) {
      const sevenDaysAgo = new Date(Date.now() - 7 * DAY_MS);
      const dayBuckets = new Map<
        string,
        {
          completed: number;
          failed: number;
          running: number;
          pending: number;
        }
      >();
      await forEachAnalyticsPage(
        (cursor) =>
          prisma.downloadTask.findMany({
            where: {
              createdAt: { gte: sevenDaysAgo },
              ...resourceTeamFilter,
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: ANALYTICS_PAGE_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: { id: true, status: true, createdAt: true },
          }),
        (download) => {
          const day = startOfUtcDay(download.createdAt);
          if (!dayBuckets.has(day)) {
            dayBuckets.set(day, {
              completed: 0,
              failed: 0,
              running: 0,
              pending: 0,
            });
          }
          const bucket = dayBuckets.get(day)!;
          const status = download.status.toLowerCase() as keyof typeof bucket;
          if (status in bucket) bucket[status]++;
        },
      );
      results.downloads = Array.from(dayBuckets.entries()).map(
        ([date, data]) => ({ date, ...data }),
      );
    }

    // Audit log activity (last 30 days, grouped by day)
    if (shouldIncludeAnalytics(session, type, "audit")) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS);
      const dayBuckets = new Map<
        string,
        { total: number; actions: Record<string, number> }
      >();
      await forEachAnalyticsPage(
        (cursor) =>
          prisma.auditLog.findMany({
            where: {
              createdAt: { gte: thirtyDaysAgo },
              ...resourceTeamFilter,
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: ANALYTICS_PAGE_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: { id: true, action: true, createdAt: true },
          }),
        (audit) => {
          const day = startOfUtcDay(audit.createdAt);
          if (!dayBuckets.has(day)) {
            dayBuckets.set(day, { total: 0, actions: {} });
          }
          const bucket = dayBuckets.get(day)!;
          bucket.total++;
          bucket.actions[audit.action] = (bucket.actions[audit.action] || 0) + 1;
        },
      );
      results.audit = Array.from(dayBuckets.entries()).map(([date, data]) => ({
        date,
        ...data,
      }));
    }

    // Image bed storage trend (last 7 days)
    if (shouldIncludeAnalytics(session, type, "image-bed")) {
      const sevenDaysAgo = new Date(Date.now() - 7 * DAY_MS);
      const dayBuckets = new Map<string, { count: number; size: number }>();
      await forEachAnalyticsPage(
        (cursor) =>
          prisma.imageUpload.findMany({
            where: {
              createdAt: { gte: sevenDaysAgo },
              // ImageUpload.teamId is team-scoped (legacy null still visible via teamWhere).
              ...resourceTeamFilter,
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: ANALYTICS_PAGE_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: { id: true, sizeBytes: true, createdAt: true },
          }),
        (image) => {
          const day = startOfUtcDay(image.createdAt);
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

    return withCacheHeaders(NextResponse.json(results), CachePresets.shortLived);
  });
}
