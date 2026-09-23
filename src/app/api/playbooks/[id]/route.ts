import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import {
  deletePlaybook,
  getPlaybook,
  updatePlaybook,
} from "@/lib/playbook/service";
import { updatePlaybookSchema } from "@/lib/playbook/schema";
import { withApiRoute } from "@/lib/http/api-guard";
import { apiError } from "@/lib/http/api-error";
import { GENERAL_READ_LIMIT, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { requirePlaybookId } from "@/lib/playbook/route-params";

export const dynamic = "force-dynamic";

type PlaybookRouteContext = { params: Promise<{ id?: string }> };

export async function GET(request: Request, { params }: PlaybookRouteContext) {
  return withApiRoute(
    request,
    { permission: "playbook:read", rateLimit: GENERAL_READ_LIMIT, errorStatus: 500, errorMessage: apiCopy("apiCopy.server.error.dfe0c2e8") },
    async ({ session }) => {
      const id = await requirePlaybookId(params);
      const playbook = await getPlaybook(id, session);
      if (!playbook) {
        return apiError({ status: 404, code: "NOT_FOUND", message: apiCopy("apiCopy.playbook.not.found.1243e47f") });
      }
      return NextResponse.json({ playbook });
    },
  );
}

export async function PATCH(request: Request, { params }: PlaybookRouteContext) {
  return withApiRoute(
    request,
    { permission: "playbook:manage", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 400, errorMessage: apiCopy("apiCopy.failed.to.update.8eb4917b"), bodySchema: updatePlaybookSchema },
    async ({ session, body }) => {
      const id = await requirePlaybookId(params);
      const updatedById = session.userId;
      // updatePlaybook already audits playbook.update
      const playbook = await updatePlaybook({ ...(body as object), id }, updatedById, session);
      return NextResponse.json({ playbook });
    },
  );
}

export async function DELETE(request: Request, { params }: PlaybookRouteContext) {
  return withApiRoute(
    request,
    { permission: "playbook:manage", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 400, errorMessage: apiCopy("apiCopy.failed.to.delete.f625b14e") },
    async ({ session }) => {
      const id = await requirePlaybookId(params);
      // deletePlaybook already audits playbook.delete
      await deletePlaybook(id, session.userId, session);
      return NextResponse.json({ success: true });
    },
  );
}
