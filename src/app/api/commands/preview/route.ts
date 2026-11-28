import { NextResponse } from "next/server";
import { z } from "zod";
import { verifiedBearerTokenId } from "@/lib/auth/bearer-token";
import { previewCommandSubmission } from "@/lib/command/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";
import { apiCopy } from "@/lib/i18n/api-copy";

export const dynamic = "force-dynamic";

const previewCommandBodySchema = z.object({
  command: z.string().max(10_000, "Command content is too long"),
  serverIds: z.array(z.string().trim().min(1)).max(500).optional(),
  approvalRequired: z.boolean().optional(),
});

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "command:create",
      optionalTokenPermissions: ["command:execute", "command:approve", "server:read"],
      rateLimit: GENERAL_READ_LIMIT,
      bodySchema: previewCommandBodySchema,
      errorMessage: apiCopy("apiCopy.operation.failed.4e1af7c7"),
    },
    async ({ session, body }) => {
      const preview = await previewCommandSubmission(
        {
          command: body.command,
          serverIds: body.serverIds,
          approvalRequired: body.approvalRequired,
          viaToken: Boolean(verifiedBearerTokenId(session)),
        },
        session,
      );
      return NextResponse.json({ preview });
    },
  );
}
