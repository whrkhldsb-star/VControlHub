import { z } from "zod";

import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { listMediaItems, scanMediaFromFileEntries } from "@/lib/media/service";

import { AuthError } from "@/lib/errors";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: "获取媒体列表失败" },
    async () => {
      const { type, q, favorite, tag } = parseSearchParams(
        request,
        z.object({
          type: z.enum(["image", "video", "audio"]).optional(),
          q: z.string().trim().min(1).optional(),
          favorite: z
            .string()
            .optional()
            .transform((value) => value === "1"),
          tag: z.string().trim().min(1).optional(),
        }),
      );

      return NextResponse.json({
        media: await listMediaItems({
          mediaType: type,
          q,
          favorite: favorite ? true : undefined,
          tag,
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
        throw new AuthError("未认证");
      return NextResponse.json(await scanMediaFromFileEntries(session.userId));
    },
  );
}
