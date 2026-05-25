import { NextResponse } from "next/server";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { getStorageOverview } from "@/lib/storage/service";

export const dynamic = "force-dynamic";

const SUPPORTED_DRIVER_FILTERS = new Set(["LOCAL", "SFTP"]);

export async function GET(request: Request) {
  const session = await requireSession();
  if (!sessionHasPermission(session, "storage:read")) {
    return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  }

  const url = new URL(request.url);
  const driverFilter = (url.searchParams.get("driver") ?? "").trim().toUpperCase();
  if (driverFilter && !SUPPORTED_DRIVER_FILTERS.has(driverFilter)) {
    return NextResponse.json({ error: "不支持的存储节点类型" }, { status: 400 });
  }

  const storage = await getStorageOverview();
  const nodes = storage.nodes
    .filter((node) => !driverFilter || node.driver === driverFilter)
    .map((node) => ({
      id: node.id,
      name: node.name,
      driver: node.driver,
      basePath: node.basePath,
    }));

  return NextResponse.json({ nodes });
}
