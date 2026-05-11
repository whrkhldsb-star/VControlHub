import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { z } from "zod";

import { createBackupRecord, listBackupRecords } from "@/lib/backup/service";

export const dynamic = "force-dynamic";

const createBackupSchema = z.object({
  type: z.enum(["DATABASE", "FILES", "FULL"]),
  note: z.string().trim().max(500, "备注最多 500 个字符").optional(),
});

export async function GET() {
  const session = await requireSession();
  if (!sessionHasPermission(session, "backup:read")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  return NextResponse.json({ backups: await listBackupRecords() });
}

async function readRequestBody(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    return {
      type: formData.get("type"),
      note: formData.get("note") || undefined,
    };
  }
  return request.json().catch(() => ({}));
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!sessionHasPermission(session, "backup:create")) return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  const body = await readRequestBody(request);
  const parsed = createBackupSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "备份参数无效" }, { status: 400 });
  const backup = await createBackupRecord({ type: parsed.data.type, createdBy: session.userId, note: parsed.data.note });
  if ((request.headers.get("accept") || "").includes("text/html")) {
    return NextResponse.redirect(new URL("/backups", request.url), { status: 303 });
  }
  return NextResponse.json({ backup }, { status: 201 });
}
