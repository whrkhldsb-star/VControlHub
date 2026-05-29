import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { listMediaItems, scanMediaFromFileEntries } from "@/lib/media/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: "获取媒体列表失败" },
    async () => {
      const searchParams = new URL(request.url).searchParams;
      const type = searchParams.get("type");

      return NextResponse.json({
        media: await listMediaItems({
          mediaType: type === "image" || type === "video" ? type : undefined,
          q: searchParams.get("q") ?? undefined,
        }),
      });
    },
  );
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "media:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "操作失败",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });
      return NextResponse.json(await scanMediaFromFileEntries(session.userId));
    },
  );
}
