import { NextResponse } from "next/server";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { getStorageOverview } from "@/lib/storage/service";

export const dynamic = "force-dynamic";

const SUPPORTED_DRIVER_FILTERS = new Set(["LOCAL", "SFTP"]);

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: "读取存储节点失败" },
    async ({ session }) => {
      const url = new URL(request.url);
      const driverFilter = (url.searchParams.get("driver") ?? "")
        .trim()
        .toUpperCase();
      if (driverFilter && !SUPPORTED_DRIVER_FILTERS.has(driverFilter)) {
        return NextResponse.json(
          { error: "不支持的存储节点类型" },
          { status: 400 },
        );
      }

      const storage = await getStorageOverview();
      const canManageNodes = Boolean(session && sessionHasPermission(session, "storage:manage-node"));
      const readableNodeIds = canManageNodes || !session
        ? null
        : new Set(
            (await prisma.userStorageAccess.findMany({
              where: { userId: session.userId, canRead: true },
              select: { storageNodeId: true },
              distinct: ["storageNodeId"],
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
