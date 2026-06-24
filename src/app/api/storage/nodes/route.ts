import { NextResponse } from "next/server";

import { z } from "zod";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { getStorageOverview } from "@/lib/storage/service";

export const dynamic = "force-dynamic";

const SUPPORTED_DRIVER_FILTERS = new Set(["LOCAL", "SFTP"]);
const driverFilterSchema = z
  .object({
    driver: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .refine((value) => value === "" || SUPPORTED_DRIVER_FILTERS.has(value), "不支持的存储节点类型")
      .optional(),
  })
  .transform((value) => value.driver ?? "");

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: "读取存储节点失败" },
    async ({ session }) => {
      const driverFilter = parseSearchParams(request, driverFilterSchema);

      const storage = await getStorageOverview();
      const canManageNodes = Boolean(session && sessionHasPermission(session, "storage:manage-node"));
      const readableNodeIds = canManageNodes || !session
        ? null
        : new Set(
            (await prisma.userStorageAccess.findMany({
              where: { userId: session.userId, canRead: true },
              select: { storageNodeId: true },
              distinct: ["storageNodeId"],
              take: 500,
            })).map((grant) => grant.storageNodeId),
          );
      const nodes = storage.nodes
        .filter((node) => !driverFilter || node.driver === driverFilter)
        .filter((node) => node.driver !== "SFTP" || Boolean(node.serverId || node.server))
        .filter((node) => readableNodeIds === null || readableNodeIds.has(node.id))
        .map((node) => ({
          id: node.id,
          name: node.name,
          driver: node.driver,
          basePath: node.basePath,
          ...(node.driver === "SFTP"
            ? {
                serverId: node.serverId ?? null,
                serverName: node.server?.name ?? null,
              }
            : {}),
        }));

      return NextResponse.json({ nodes });
    },
  );
}
