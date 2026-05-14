/**
 * @deprecated No frontend currently calls this endpoint.
 * Kept for future deployment-export feature.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiPermission } from "@/lib/auth/require-api-permission";
import { buildPortableDeploymentPackage, createDeploymentExport } from "@/lib/deploy-export/service";

const deployExportPostSchema = z.object({
  format: z.enum(["docker-compose", "systemd", "env"]),
  services: z.array(z.object({ name: z.string(), type: z.string() })),
  serverId: z.string().optional(),
  domain: z.string().optional(),
  appName: z.string().optional(),
});

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	const authed = await requireApiPermission("deploy:export");
	if (authed instanceof NextResponse) return authed;
	const { session } = authed;

	const domain = new URL(request.url).searchParams.get("domain") ?? undefined;
	return NextResponse.json(buildPortableDeploymentPackage({ domain }));
}

export async function POST(request: Request) {
	const authed = await requireApiPermission("deploy:export");
	if (authed instanceof NextResponse) return authed;
	const { session } = authed;

	const body = await request.json().catch(() => ({}));
	const parsed = deployExportPostSchema.safeParse(body);
	if (!parsed.success) return NextResponse.json({ error: "输入校验失败", details: parsed.error.flatten().fieldErrors }, { status: 400 });
	const data = parsed.data;
	return NextResponse.json(
		{ export: await createDeploymentExport({ userId: session.userId, domain: data.domain, appName: data.appName }) },
		{ status: 201 },
	);
}
