import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import {
  filePreferenceSchema,
  listFilePreferences,
  updateFilePreference,
} from "@/lib/files/preferences";
import { apiCopy } from "@/lib/i18n/api-copy";

export const dynamic = "force-dynamic";
const querySchema = z.object({
  mode: z.enum(["favorites", "recent", "tags", "entry"]).default("favorites"),
  tag: z.string().max(32).optional(),
  fileEntryId: z.string().max(128).optional(),
  cursor: z.string().max(128).optional(),
});

export async function GET(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "storage:read",
      querySchema,
      errorMessage: apiCopy("apiCopy.failed.to.fetch.preferences.ffdd88c2"),
    },
    async ({ session, query }) => {
      return NextResponse.json(await listFilePreferences(session, query), {
        headers: { "Cache-Control": "private, no-store" },
      });
    },
  );
}

export async function PATCH(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "storage:read",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: filePreferenceSchema,
      errorMessage: apiCopy("apiCopy.failed.to.save.preferences.7cb9dce5"),
    },
    async ({ session, body }) => {
      return NextResponse.json(await updateFilePreference(session, body));
    },
  );
}
