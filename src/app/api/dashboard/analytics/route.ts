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
      const metrics = await prisma.metricSnapshot.findMany({
        where: {
          createdAt: { gte: twentyFourHoursAgo },
          ...metricTeamFilter,
        },
        orderBy: { createdAt: "asc" },
        take: 5000,
        select: {
          cpuUsage: true,
          memUsage: true,
          diskUsage: true,
          createdAt: true,
        },
      });
      // Group by time bucket (1h intervals)
      const buckets = new Map<
        string,
        { cpu: number[]; memory: number[]; disk: number[] }
      >();
      for (const m of metrics) {
        const key = startOfUtcHour(m.createdAt);
        if (!buckets.has(key))
          buckets.set(key, { cpu: [], memory: [], disk: [] });
        const bucket = buckets.get(key)!;
        bucket.cpu.push(m.cpuUsage);
        bucket.memory.push(m.memUsage);
        bucket.disk.push(m.diskUsage);
      }
      results.servers = Array.from(buckets.entries()).map(([time, data]) => ({
        time,
        cpu: data.cpu.length
          ? Math.round(data.cpu.reduce((a, b) => a + b, 0) / data.cpu.length)
          : 0,
        memory: data.memory.length
          ? Math.round(
              data.memory.reduce((a, b) => a + b, 0) / data.memory.length,
            )
          : 0,
        disk: data.disk.length
          ? Math.round(data.disk.reduce((a, b) => a + b, 0) / data.disk.length)
          : 0,
      }));
    }

    // Download task trend (last 7 days)
    if (shouldIncludeAnalytics(session, type, "downloads")) {
      const sevenDaysAgo = new Date(Date.now() - 7 * DAY_MS);
      const downloads = await prisma.downloadTask.findMany({
        where: {
          createdAt: { gte: sevenDaysAgo },
          ...resourceTeamFilter,
        },
        orderBy: { createdAt: "asc" },
        take: 5000,
        select: { status: true, createdAt: true },
      });
      const dayBuckets = new Map<
        string,
        { completed: number; failed: number; running: number; pending: number }
      >();
      for (const d of downloads) {
        const day = startOfUtcDay(d.createdAt);
        if (!dayBuckets.has(day))
          dayBuckets.set(day, {
            completed: 0,
            failed: 0,
            running: 0,
            pending: 0,
          });
        const bucket = dayBuckets.get(day)!;
        const status = d.status.toLowerCase() as keyof typeof bucket;
        if (status in bucket) bucket[status]++;
      }
      results.downloads = Array.from(dayBuckets.entries()).map(
        ([date, data]) => ({ date, ...data }),
      );
    }

    // Audit log activity (last 30 days, grouped by day)
    if (shouldIncludeAnalytics(session, type, "audit")) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS);
      const audits = await prisma.auditLog.findMany({
        where: {
          createdAt: { gte: thirtyDaysAgo },
          ...resourceTeamFilter,
        },
        orderBy: { createdAt: "asc" },
        take: 10000,
        select: { action: true, createdAt: true },
      });
      const dayBuckets = new Map<
        string,
        { total: number; actions: Record<string, number> }
      >();
      for (const a of audits) {
        const day = startOfUtcDay(a.createdAt);
        if (!dayBuckets.has(day))
          dayBuckets.set(day, { total: 0, actions: {} });
        const bucket = dayBuckets.get(day)!;
        bucket.total++;
        bucket.actions[a.action] = (bucket.actions[a.action] || 0) + 1;
      }
      results.audit = Array.from(dayBuckets.entries()).map(([date, data]) => ({
        date,
        ...data,
      }));
    }

    // Image bed storage trend (last 7 days)
    if (shouldIncludeAnalytics(session, type, "image-bed")) {
      const sevenDaysAgo = new Date(Date.now() - 7 * DAY_MS);
      const images = await prisma.imageUpload.findMany({
        where: {
          createdAt: { gte: sevenDaysAgo },
          // ImageUpload.teamId is team-scoped (legacy null still visible via teamWhere).
          ...resourceTeamFilter,
        },
        orderBy: { createdAt: "asc" },
        take: 5000,
        select: { sizeBytes: true, createdAt: true },
      });
      const dayBuckets = new Map<string, { count: number; size: number }>();
      for (const img of images) {
        const day = startOfUtcDay(img.createdAt);
        if (!dayBuckets.has(day)) dayBuckets.set(day, { count: 0, size: 0 });
        const bucket = dayBuckets.get(day)!;
        bucket.count++;
        bucket.size += img.sizeBytes;
      }
      results.imageBed = Array.from(dayBuckets.entries()).map(
        ([date, data]) => ({ date, ...data }),
      );
    }

    return withCacheHeaders(NextResponse.json(results), CachePresets.shortLived);
  });
}
