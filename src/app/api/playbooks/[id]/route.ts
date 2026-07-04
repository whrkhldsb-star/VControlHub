import { NextResponse } from "next/server";

import {
  deletePlaybook,
  getPlaybook,
  updatePlaybook,
} from "@/lib/playbook/service";
import { updatePlaybookSchema } from "@/lib/playbook/schema";
import { withApiRoute } from "@/lib/http/api-guard";
import { apiError } from "@/lib/http/api-error";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

type PlaybookRouteContext = { params: Promise<{ id?: string }> };

async function requirePlaybookId(params: PlaybookRouteContext["params"]): Promise<string> {
  const { id } = await params;
  const normalized = id?.trim();
  if (!normalized) throw new ValidationError("缺少 playbook id");
  return normalized;
}

export async function GET(request: Request, { params }: PlaybookRouteContext) {
  return withApiRoute(
    request,
    { permission: "playbook:read", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 500, errorMessage: "服务器错误" },
    async () => {
      const id = await requirePlaybookId(params);
      const playbook = await getPlaybook(id);
      if (!playbook) {
        return apiError({ status: 404, code: "NOT_FOUND", message: "playbook 不存在" });
      }
      return NextResponse.json({ playbook });
    },
  );
}

export async function PATCH(request: Request, { params }: PlaybookRouteContext) {
  return withApiRoute(
    request,
    { permission: "playbook:manage", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 400, errorMessage: "更新失败", bodySchema: updatePlaybookSchema },
    async ({ session, body }) => {
      const id = await requirePlaybookId(params);
      const updatedById = session?.userId ?? "";
      const playbook = await updatePlaybook({ ...(body as object), id }, updatedById);
      return NextResponse.json({ playbook });
    },
  );
}

export async function DELETE(request: Request, { params }: PlaybookRouteContext) {
  return withApiRoute(
    request,
    { permission: "playbook:manage", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 400, errorMessage: "删除失败" },
    async ({ session }) => {
      const id = await requirePlaybookId(params);
      await deletePlaybook(id, session?.userId ?? "");
      return NextResponse.json({ success: true });
    },
  );
}
