import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * Image bed statistics API.
 * GET /api/images/stats — returns usage stats for the current user (or all for admin).
 */
import { NextResponse } from "next/server";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { imageTeamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { withCacheHeaders, CachePresets } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "image:read", errorMessage: apiCopy("apiCopy.failed.to.fetch.statistics.97cf5fdd") },
    async ({ session }) => {
      // Same bar as list showAll: user:read is too broad for fleet-wide stats.
      // media:manage may see others' images but only in the current team.
      const canListAll =
        sessionHasPermission(session, "team:manage") ||
        sessionHasPermission(session, "media:manage");
      const where: Record<string, unknown> = canListAll
        ? { ...imageTeamWhere(session) }
        : { userId: session.userId };

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

      // Count seven UTC calendar days without loading/truncating image rows.
      // Prisma predicates preserve the same owner/team scope as the totals.
      const now = new Date();
      const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const dayMs = 24 * 60 * 60 * 1000;
      const dailyCounts = await Promise.all(Array.from({ length: 7 }, async (_, index) => {
        const start = new Date(today - (6 - index) * dayMs);
        const end = new Date(start.getTime() + dayMs);
        const count = await prisma.imageUpload.count({
          where: { ...where, createdAt: { gte: start, lt: end } },
        });
        return { date: start.toISOString().slice(0, 10), count };
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
        CachePresets.shortLived,
      );
    },
  );
}
