import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { createBackupRecord, listBackupRecords } from "@/lib/backup/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!sessionHasPermission(session, "backup:read")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  return NextResponse.json({ backups: await listBackupRecords() });
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!sessionHasPermission(session, "backup:create")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const type = ["DATABASE", "FILES", "FULL"].includes(body.type) ? body.type : "DATABASE";
  return NextResponse.json({ backup: await createBackupRecord({ type, createdBy: session.userId, note: body.note }) }, { status: 201 });
}
