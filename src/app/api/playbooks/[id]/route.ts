import { NextResponse } from "next/server";

import {
  deletePlaybook,
  getPlaybook,
  updatePlaybook,
} from "@/lib/playbook/service";
import { idQuerySchema, updatePlaybookSchema } from "@/lib/playbook/schema";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "playbook:read", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 500, errorMessage: "服务器错误" },
    async () => {
      const { id } = parseSearchParams(request, idQuerySchema);
      if (!id) throw new ValidationError("缺少 playbook id");
      const playbook = await getPlaybook(id);
      if (!playbook) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
      return NextResponse.json({ playbook });
    },
  );
}

export async function PATCH(request: Request) {
  return withApiRoute(
    request,
    { permission: "playbook:manage", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 400, errorMessage: "更新失败" },
    async ({ session }) => {
      const rawBody = await request.json();
      const parsed = updatePlaybookSchema.safeParse(rawBody);
      if (!parsed.success) {
        throw new ValidationError("输入参数无效");
      }
      const updatedById = session?.userId ?? "";
      const playbook = await updatePlaybook(parsed.data, updatedById);
      return NextResponse.json({ playbook });
    },
  );
}

export async function DELETE(request: Request) {
  return withApiRoute(
    request,
    { permission: "playbook:manage", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 400, errorMessage: "删除失败" },
    async ({ session }) => {
      const { id } = parseSearchParams(request, idQuerySchema);
      if (!id) throw new ValidationError("缺少 playbook id");
      await deletePlaybook(id, session?.userId ?? "");
      return NextResponse.json({ success: true });
    },
  );
}
