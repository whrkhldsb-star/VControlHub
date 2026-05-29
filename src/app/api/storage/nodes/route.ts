import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { getStorageOverview } from "@/lib/storage/service";

export const dynamic = "force-dynamic";

const SUPPORTED_DRIVER_FILTERS = new Set(["LOCAL", "SFTP"]);

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: "读取存储节点失败" },
    async () => {
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
      const nodes = storage.nodes
        .filter((node) => !driverFilter || node.driver === driverFilter)
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
