import { apiCopy } from "@/lib/i18n/api-copy";
import { z } from "zod";

import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { countMediaItems, listMediaItems, MEDIA_MAX_PAGE_SIZE, scanMediaFromFileEntries } from "@/lib/media/service";

import { auditUserAction } from "@/lib/audit/service";
import { tryAcquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { BusinessError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read", rateLimit: GENERAL_READ_LIMIT, errorMessage: apiCopy("apiCopy.failed.to.fetch.media.list.74ffa9e4") },
    async ({ session }) => {
      const { type, q, favorite, tag, page, pageSize } = parseSearchParams(
        request,
        z.object({
          type: z.enum(["image", "video", "audio"]).optional(),
          q: z.string().trim().min(1).optional(),
          favorite: z
            .string()
            .optional()
            .transform((value) => value === "1"),
          tag: z.string().trim().min(1).optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(MEDIA_MAX_PAGE_SIZE).default(MEDIA_MAX_PAGE_SIZE),
        }),
      );

      const filters = { mediaType: type, q, favorite: favorite ? true : undefined, tag, session };
      const [media, total] = await Promise.all([
        listMediaItems({ ...filters, page, pageSize }),
        countMediaItems(filters),
      ]);
      return NextResponse.json({ media, total, page, pageSize });
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
      // One scan per customer at a time (A5-11): a second click used to start a
      // concurrent full scan that overwrote the first one's results.
      const release = await tryAcquireAdvisoryLock("media-scan", session.currentTeamId ?? "platform");
      if (!release) throw new BusinessError(t("backend.media.scanInProgress"), undefined, 409);
      let result: Awaited<ReturnType<typeof scanMediaFromFileEntries>>;
      try {
        result = await scanMediaFromFileEntries(session.userId, session);
      } finally {
        await release();
      }
      // The scan reports `upserted`/`removed`; the old `created` field never existed and audited as null.
      await auditUserAction(session.userId, "media.scan", {
        scanned: result.scanned,
        upserted: result.upserted,
        removed: result.removed,
      }, undefined, session.currentTeamId);
      return NextResponse.json(result);
    },
  );
}
