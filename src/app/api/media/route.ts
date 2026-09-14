import { apiCopy } from "@/lib/i18n/api-copy";
import { z } from "zod";

import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { listMediaItems, scanMediaFromFileEntries } from "@/lib/media/service";

import { AuthError } from "@/lib/errors";
import { auditUserAction } from "@/lib/audit/service";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read", rateLimit: GENERAL_READ_LIMIT, errorMessage: apiCopy("apiCopy.failed.to.fetch.media.list.74ffa9e4") },
    async ({ session }) => {
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
          session: session ?? undefined,
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
      errorMessage: apiCopy("apiCopy.operation.failed.4e1af7c7"),
    },
    async ({ session }) => {
      if (!session)
        throw new AuthError(apiCopy("apiCopy.not.authenticated.76d1efbe"));
      const result = await scanMediaFromFileEntries(session.userId, session);
      await auditUserAction(session.userId, "media.scan", {
        scanned: typeof result === "object" && result !== null && "scanned" in result
          ? Number((result as { scanned?: unknown }).scanned ?? 0)
          : null,
        created: typeof result === "object" && result !== null && "created" in result
          ? Number((result as { created?: unknown }).created ?? 0)
          : null,
      }, undefined, session?.currentTeamId);
      return NextResponse.json(result);
    },
  );
}
