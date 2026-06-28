import { NextResponse } from "next/server";
import { z } from "zod";

import {
  buildPortableDeploymentPackage,
  createDeploymentExport,
} from "@/lib/deploy-export/service";
import { withApiRoute } from "@/lib/http/api-guard";
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

const deployExportQuerySchema = z.object({
  domain: z.string().trim().min(1).optional(),
});

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "deploy:export", querySchema: deployExportQuerySchema }, async ({ query }) => {
    return NextResponse.json(buildPortableDeploymentPackage({ domain: query.domain }));
  });
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    { permission: "deploy:export", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: deployExportPostSchema },
    async ({ session, body: data }) => {
      if (!session)
        throw new AuthError("未认证");

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
