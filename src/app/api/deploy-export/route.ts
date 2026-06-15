import { NextResponse } from "next/server";
import { z } from "zod";

import {
  buildPortableDeploymentPackage,
  createDeploymentExport,
} from "@/lib/deploy-export/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

import { AuthError } from "@/lib/errors";
const deployExportPostSchema = z.object({
  // Legacy clients may still send these fields; the current export service only
  // needs domain/appName, so keep them optional instead of blocking the UI.
  format: z.enum(["docker-compose", "systemd", "env"]).optional(),
  services: z.array(z.object({ name: z.string(), type: z.string() })).optional(),
  serverId: z.string().optional(),
  domain: z.string().trim().optional(),
  appName: z.string().trim().optional(),
});

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "deploy:export" }, async () => {
    const { domain } = parseSearchParams(
      request,
      z.object({ domain: z.string().trim().min(1).optional() }),
    );
    return NextResponse.json(buildPortableDeploymentPackage({ domain }));
  });
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    { permission: "deploy:export", rateLimit: GENERAL_WRITE_LIMIT },
    async ({ session }) => {
      if (!session)
        throw new AuthError("未认证");

      const body = await request.json().catch(() => ({}));
      const parsed = deployExportPostSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "输入校验失败",
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 400 },
        );
      }
      const data = parsed.data;
      return NextResponse.json(
        {
          export: await createDeploymentExport({
            userId: session.userId,
            domain: data.domain,
            appName: data.appName,
          }),
        },
        { status: 201 },
      );
    },
  );
}
