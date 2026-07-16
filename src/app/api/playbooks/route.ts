import { NextResponse } from "next/server";

import {
  createPlaybook,
  listPlaybooks,
} from "@/lib/playbook/service";
import { createPlaybookSchema } from "@/lib/playbook/schema";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "playbook:read", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 500, errorMessage: "Server error" },
    async (ctx) => {
      const playbooks = await listPlaybooks(ctx.session ?? undefined);
      return NextResponse.json({ playbooks });
    },
  );
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    { permission: "playbook:manage", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 400, errorMessage: "Failed to create", bodySchema: createPlaybookSchema },
    async ({ session, body }) => {
      const createdById = session?.userId ?? "";
      // createPlaybook already audits playbook.create — do not double-audit here.
      const playbook = await createPlaybook(body, createdById, session ?? undefined);
      return NextResponse.json({ playbook });
    },
  );
}
