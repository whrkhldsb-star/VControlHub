import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * Image bed statistics API.
 * GET /api/images/stats — returns usage stats for the current user (or all for admin).
 */
import { NextResponse } from "next/server";

import { imageStatisticsWhere } from "@/lib/image/statistics-scope";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";
import { withCacheHeaders, CachePresets } from "@/lib/cache";
import { appTimeZoneDateKey, shiftAppTimeZoneDay } from "@/lib/datetime/time-zone";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "image:read", rateLimit: GENERAL_READ_LIMIT, errorMessage: apiCopy("apiCopy.failed.to.fetch.statistics.97cf5fdd") },
    async ({ session }) => {
      const where = imageStatisticsWhere(session);

      // Total count and size
      const [totalCount, totalSizeResult, albumBreakdown] = await Promise.all([
        prisma.imageUpload.count({ where }),
        prisma.imageUpload.aggregate({
          where,
          _sum: { sizeBytes: true },
        }),
        // Per-album breakdown
        prisma.imageUpload.groupBy({
          by: ["album"],
          where,
          _count: { id: true },
          _sum: { sizeBytes: true },
          orderBy: { _count: { id: "desc" } },
        }),
      ]);

      // Count the last seven application-time-zone days (as every other date in
      // the app) without loading/truncating image rows. Prisma predicates
      // preserve the same owner/team scope as the totals.
      const now = new Date();
      const dailyCounts = await Promise.all(Array.from({ length: 7 }, async (_, index) => {
        const start = shiftAppTimeZoneDay(now, index - 6);
        const end = shiftAppTimeZoneDay(now, index - 5);
        const count = await prisma.imageUpload.count({
          where: { ...where, createdAt: { gte: start, lt: end } },
        });
        return { date: appTimeZoneDateKey(start), count };
      }));
      const uploadTrend = dailyCounts.filter(({ count }) => count > 0);

      const totalSizeBytes = totalSizeResult._sum.sizeBytes || 0;

      // Format album breakdown
      const albums = albumBreakdown.map((album) => ({
        album: album.album || "Uncategorized",
        count: album._count.id,
        sizeBytes: album._sum.sizeBytes || 0,
      }));

      return withCacheHeaders(
        NextResponse.json({
          totalCount,
          totalSizeBytes,
          totalSizeMB: Math.round((totalSizeBytes / 1024 / 1024) * 100) / 100,
          albums,
          uploadTrend,
        }),
        CachePresets.noStore,
      );
    },
  );
}
