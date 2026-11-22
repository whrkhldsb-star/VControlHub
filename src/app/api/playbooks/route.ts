import { apiCopy } from "@/lib/i18n/api-copy";
import { z } from "zod";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { NextResponse } from "next/server";

import {
  createPlaybook,
  listPlaybooks,
} from "@/lib/playbook/service";
import { createPlaybookSchema } from "@/lib/playbook/schema";
import { PLAYBOOK_APPROVAL_PERMISSION, PLAYBOOK_COMMAND_PERMISSION, PLAYBOOK_RUN_PERMISSION } from "@/lib/playbook/permissions";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "playbook:read", optionalTokenPermissions: ["playbook:manage", PLAYBOOK_COMMAND_PERMISSION, PLAYBOOK_APPROVAL_PERMISSION], rateLimit: GENERAL_READ_LIMIT, errorStatus: 500, errorMessage: apiCopy("apiCopy.server.error.dfe0c2e8") },
    async (ctx) => {
      const { after } = parseSearchParams(request, z.object({ after: z.string().min(1).max(200).optional() }));
      const rows = await listPlaybooks(ctx.session, { after, take: 501 });
      const playbooks = rows.slice(0, 500);
      return NextResponse.json({ playbooks, nextCursor: rows.length > 500 ? playbooks.at(-1)!.id : null });
    },
  );
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    { permission: "playbook:manage", optionalTokenPermissions: [PLAYBOOK_RUN_PERMISSION, PLAYBOOK_COMMAND_PERMISSION, PLAYBOOK_APPROVAL_PERMISSION], rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 400, errorMessage: apiCopy("apiCopy.failed.to.create.99af0e81"), bodySchema: createPlaybookSchema },
    async ({ session, body }) => {
      const createdById = session.userId;
      // createPlaybook already audits playbook.create — do not double-audit here.
      const playbook = await createPlaybook(body, createdById, session);
      return NextResponse.json({ playbook });
    },
  );
}
