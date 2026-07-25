import { NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { updateMediaTags } from "@/lib/media/service";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  favorite: z.boolean().optional(),
  // Bound tag payload to prevent DB/response bloat from unbounded arrays.
  tags: z
    .array(z.string().trim().min(1).max(64))
    .max(20, "At most 20 tags are allowed")
    .optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "media:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "Operation failed",
      bodySchema: patchSchema,
    },
    async ({ session, body }) => {
      const { id } = await params;

      // Team scope via StorageNode.teamId — never mutate by bare media id.
      const updated = await updateMediaTags({
        id,
        tags: body.tags,
        favorite: body.favorite,
        session,
      });

      await auditUserAction(session?.userId ?? "", "media.update", {
        mediaId: id,
        favorite: body.favorite ?? null,
        tagsUpdated: body.tags !== undefined,
      }, undefined, session?.currentTeamId);
      return NextResponse.json({ item: updated });
    },
  );
}
