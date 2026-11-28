import { NextResponse } from "next/server";
import { getCommandRequestDetailForViewer } from "@/lib/command/service";
import { NotFoundError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";
import { apiCopy } from "@/lib/i18n/api-copy";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "command:read",
      optionalTokenPermissions: ["server:read", "command:approve"],
      rateLimit: GENERAL_READ_LIMIT,
      errorStatus: 404,
      errorMessage: apiCopy("apiCopy.not.found.e3ebaa16"),
    },
    async ({ session }) => {
      const { id } = await params;
      const command = await getCommandRequestDetailForViewer(session, id);
      if (!command) {
        throw new NotFoundError(apiCopy("apiCopy.not.found.e3ebaa16"));
      }
      return NextResponse.json({ command });
    },
  );
}
