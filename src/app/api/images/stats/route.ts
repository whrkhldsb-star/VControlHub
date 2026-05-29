/**
 * Image bed statistics API.
 * GET /api/images/stats — returns usage stats for the current user (or all for admin).
 */
import { NextResponse } from "next/server";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { requireAuth: true, errorMessage: "获取统计信息失败" },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: "未登录或会话已过期" },
          { status: 401 },
        );
      const isAdmin = sessionHasPermission(session, "user:read");
      const where: Record<string, unknown> = isAdmin
        ? {}
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

      // Upload trend: last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const recentImages = await prisma.imageUpload.findMany({
        where: { ...where, createdAt: { gte: sevenDaysAgo } },
        orderBy: { createdAt: "asc" },
        take: 5000,
        select: { createdAt: true },
      });

      // Group by date manually
      const trendMap = new Map<string, number>();
      for (const img of recentImages) {
        const dateKey = img.createdAt.toISOString().slice(0, 10);
        trendMap.set(dateKey, (trendMap.get(dateKey) || 0) + 1);
      }
      const uploadTrend = Array.from(trendMap.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const totalSizeBytes = totalSizeResult._sum.sizeBytes || 0;

      // Format album breakdown
      const albums = albumBreakdown.map((album) => ({
        album: album.album || "未分类",
        count: album._count.id,
        sizeBytes: album._sum.sizeBytes || 0,
      }));

      return NextResponse.json({
        totalCount,
        totalSizeBytes,
        totalSizeMB: Math.round((totalSizeBytes / 1024 / 1024) * 100) / 100,
        albums,
        uploadTrend,
      });
    },
  );
}
