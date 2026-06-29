import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { prisma } from "@/lib/db";

const trafficHistoryQuerySchema = z.object({
  iface: z.string().trim().min(1).max(64).optional(),
  source: z.enum(["local", "server"]).optional(),
  hours: z
    .string()
    .trim()
    .optional()
    .transform((value) => {
      const parsed = Number.parseInt(value ?? "24", 10);
      if (!Number.isFinite(parsed)) return 24;
      return Math.min(Math.max(parsed, 1), 168);
    }),
});

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "server:read", errorMessage: "获取流量历史失败" },
    async () => {
      const { iface, source, hours } = parseSearchParams(request, trafficHistoryQuerySchema);
      const since = new Date(Date.now() - hours * 3600_000);
      const rows = await prisma.trafficSnapshot.findMany({
        where: {
          sampledAt: { gte: since },
          ...(source ? { source } : {}),
          ...(iface ? { iface } : {}),
        },
        orderBy: { sampledAt: "asc" },
        take: 5000,
        select: {
          source: true,
          serverId: true,
          iface: true,
          rxBytes: true,
          txBytes: true,
          rxRateBps: true,
          txRateBps: true,
          sampledAt: true,
        },
      });

      return NextResponse.json({
        history: rows.map((row) => ({
          source: row.source,
          serverId: row.serverId,
          iface: row.iface,
          rx: Number(row.rxRateBps),
          tx: Number(row.txRateBps),
          rxBytes: row.rxBytes.toString(),
          txBytes: row.txBytes.toString(),
          t: row.sampledAt.toISOString(),
        })),
      });
    },
  );
}
