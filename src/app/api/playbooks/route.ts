import { NextResponse } from "next/server";

import {
  createPlaybook,
  listPlaybooks,
} from "@/lib/playbook/service";
import { createPlaybookSchema } from "@/lib/playbook/schema";
import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "playbook:read", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 500, errorMessage: "服务器错误" },
    async () => {
      const playbooks = await listPlaybooks();
      return NextResponse.json({ playbooks });
    },
  );
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    { permission: "playbook:manage", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 400, errorMessage: "创建失败" },
    async ({ session }) => {
      const rawBody = await request.json();
      const parsed = createPlaybookSchema.safeParse(rawBody);
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .slice(0, 3)
          .join("; ");
        throw new ValidationError(`输入参数无效（${detail}）`);
      }
      const createdById = session?.userId ?? "";
      const playbook = await createPlaybook(parsed.data, createdById);
      auditUserAction(createdById, "playbook.create", {
        playbookId: playbook.id,
        name: playbook.name,
        stepCount: playbook.steps.length,
      });
      return NextResponse.json({ playbook });
    },
  );
}
