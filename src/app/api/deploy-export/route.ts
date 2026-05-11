import { NextResponse } from "next/server";

import { requireApiPermission } from "@/lib/auth/require-api-permission";
import { buildPortableDeploymentPackage, createDeploymentExport } from "@/lib/deploy-export/service";

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
	return NextResponse.json(
		{ export: await createDeploymentExport({ userId: session.userId, domain: body.domain, appName: body.appName }) },
		{ status: 201 },
	);
}
