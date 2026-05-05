import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { createDeploymentRunFromTemplate, listDeploymentRuns } from "@/lib/deployment/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!sessionHasPermission(session, "deploy:read")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  return NextResponse.json({ deployments: await listDeploymentRuns() });
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!sessionHasPermission(session, "deploy:run")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body?.templateId || !Array.isArray(body?.serverIds)) return NextResponse.json({ error: "templateId 与 serverIds 必填" }, { status: 400 });
  const deployment = await createDeploymentRunFromTemplate({ templateId: body.templateId, serverIds: body.serverIds, variables: body.variables ?? {}, requesterId: session.userId, reason: body.reason });
  return NextResponse.json({ deployment }, { status: 201 });
}
