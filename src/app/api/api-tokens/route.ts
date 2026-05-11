import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { z } from "zod";

import {
  ALLOWED_API_TOKEN_SCOPES,
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from "@/lib/api-token/service";
import { auditUserAction } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

const allowedScopes = new Set<string>(ALLOWED_API_TOKEN_SCOPES);

const createTokenSchema = z.object({
  name: z.string().trim().min(1, "Token 名称不能为空").max(80, "Token 名称过长"),
  scopes: z.array(z.string().trim().min(1)).default(["read"]),
  expiresAt: z.string().trim().optional().nullable(),
});

function wantsHtml(request: Request) {
  return request.headers.get("accept")?.includes("text/html") ?? false;
}

async function parseCreateBody(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const scopes = form.getAll("scopes").map(String).flatMap((value) => value.split(","));
    return {
      name: String(form.get("name") ?? ""),
      scopes: scopes.length > 0 ? scopes : undefined,
      expiresAt: form.get("expiresAt") ? String(form.get("expiresAt")) : null,
    };
  }
  return request.json().catch(() => null);
}

function validateScopes(scopes: string[]) {
  const normalized = Array.from(new Set(scopes.map((scope) => scope.trim()).filter(Boolean)));
  const invalid = normalized.filter((scope) => !allowedScopes.has(scope));
  if (invalid.length > 0) {
    throw new Error(`不支持的 scope: ${invalid.join(", ")}`);
  }
  return normalized.length > 0 ? normalized : ["read"];
}

function parseExpiresAt(value?: string | null) {
  if (!value) return null;
  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime())) throw new Error("过期时间格式无效");
  if (expiresAt.getTime() <= Date.now()) throw new Error("过期时间必须晚于当前时间");
  return expiresAt;
}

export async function GET() {
  const session = await requireSession();
  if (!sessionHasPermission(session, "api-token:manage")) {
    return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  }
  return NextResponse.json({ tokens: await listApiTokens(session.userId) });
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!sessionHasPermission(session, "api-token:manage")) {
    return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  }

  try {
    const parsed = createTokenSchema.parse(await parseCreateBody(request));
    const scopes = validateScopes(parsed.scopes);
    const expiresAt = parseExpiresAt(parsed.expiresAt);
    const result = await createApiToken({ userId: session.userId, name: parsed.name, scopes, expiresAt });

    auditUserAction(session.userId, "api_token.create", {
      tokenId: result.apiToken.id,
      name: result.apiToken.name,
      tokenPrefix: result.apiToken.tokenPrefix,
      tokenSuffix: result.apiToken.tokenSuffix,
      scopes: result.apiToken.scopes,
      expiresAt: result.apiToken.expiresAt ? result.apiToken.expiresAt.toISOString() : null,
    });

    if (wantsHtml(request)) {
      return NextResponse.redirect(new URL("/api-tokens?created=1", request.url), { status: 303 });
    }
    return NextResponse.json({ token: result.token, apiToken: result.apiToken }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建 Token 失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const session = await requireSession();
  if (!sessionHasPermission(session, "api-token:manage")) {
    return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id 必填" }, { status: 400 });
  const token = await revokeApiToken({ userId: session.userId, id });
  auditUserAction(session.userId, "api_token.revoke", {
    tokenId: token.id,
    tokenPrefix: token.tokenPrefix,
    tokenSuffix: token.tokenSuffix,
  });
  return NextResponse.json({ token });
}
