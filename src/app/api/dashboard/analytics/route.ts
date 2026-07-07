/**
 * Dashboard analytics API — chart data for the main dashboard.
 * GET /api/dashboard/analytics?type=servers|downloads|audit|image-bed
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiSession } from "@/lib/auth/api-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { createLogger } from "@/lib/logging";

import { apiError } from "@/lib/http/api-error";
import { CachePresets, withCacheHeaders } from "@/lib/cache";
import type { SessionPayload } from "@/lib/auth/session";
const logger = createLogger("api:dashboard:analytics");

export const dynamic = "force-dynamic";

function canReadAnalyticsDomain(session: SessionPayload, type: "servers" | "downloads" | "audit" | "image-bed") {
  if (type === "servers") return sessionHasPermission(session, "server:read") || sessionHasPermission(session, "health:read");
  if (type === "downloads") return sessionHasPermission(session, "storage:read");
  if (type === "audit") return sessionHasPermission(session, "audit:read");
  if (type === "image-bed") return sessionHasPermission(session, "image:read") || sessionHasPermission(session, "image:write") || sessionHasPermission(session, "media:manage");
  return false;
}

function shouldIncludeAnalytics(session: SessionPayload, requested: string, type: "servers" | "downloads" | "audit" | "image-bed") {
  return (requested === "all" || requested === type) && canReadAnalyticsDomain(session, type);
}

function requestedDomainForbidden(session: SessionPayload, requested: string) {
  if (requested === "all") return false;
  if (!["servers", "downloads", "audit", "image-bed"].includes(requested)) return false;
  return !canReadAnalyticsDomain(session, requested as "servers" | "downloads" | "audit" | "image-bed");
}

export async function GET(request: Request) {
  try {
    const session = await getApiSession();
    if (!session) {
      return NextResponse.json(
        { error: "Not authenticated or session expired" },
        { status: 401 },
      );
    }

    const { type } = parseSearchParams(
      request,
      z.object({
        type: z.string().trim().min(1).default("all"),
      }),
    );

    if (requestedDomainForbidden(session, type)) {
      return apiError({ code: "FORBIDDEN", message: "Missing dashboard analytics data reading permission", status: 403 });
    }

    const results: Record<string, unknown> = {};

    // Server metrics trend (last 24h)
    if (shouldIncludeAnalytics(session, type, "servers")) {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const metrics = await prisma.metricSnapshot.findMany({
        where: { createdAt: { gte: twentyFourHoursAgo } },
        orderBy: { createdAt: "asc" },
        take: 5000,
        select: {
          serverId: true,
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
        const hour = new Date(m.createdAt);
        hour.setMinutes(0, 0, 0);
        const key = hour.toISOString();
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
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const downloads = await prisma.downloadTask.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        orderBy: { createdAt: "asc" },
        take: 5000,
        select: { status: true, createdAt: true },
      });
      const dayBuckets = new Map<
        string,
        { completed: number; failed: number; running: number; pending: number }
      >();
      for (const d of downloads) {
        const day = new Date(d.createdAt).toISOString().slice(0, 10);
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
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const audits = await prisma.auditLog.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        orderBy: { createdAt: "asc" },
        take: 10000,
        select: { action: true, createdAt: true },
      });
      const dayBuckets = new Map<
        string,
        { total: number; actions: Record<string, number> }
      >();
      for (const a of audits) {
        const day = new Date(a.createdAt).toISOString().slice(0, 10);
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
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const images = await prisma.imageUpload.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        orderBy: { createdAt: "asc" },
        take: 5000,
        select: { sizeBytes: true, createdAt: true },
      });
      const dayBuckets = new Map<string, { count: number; size: number }>();
      for (const img of images) {
        const day = new Date(img.createdAt).toISOString().slice(0, 10);
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
  } catch (error) {
    logger.error("[dashboard/analytics]", error);
    return apiError({ code: "INTERNAL_ERROR", message: "FetchanalyticsDatafailed", status: 500 });
  }
}
