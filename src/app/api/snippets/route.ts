import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { apiError } from "@/lib/http/api-error";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createSnippet, deleteSnippet, listSnippets, updateSnippet } from "@/lib/snippet/service";
import {
  createSnippetSchema,
  deleteSnippetQuerySchema,
  listSnippetsQuerySchema,
  updateSnippetSchema,
} from "@/lib/snippet/schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "snippet:manage", querySchema: listSnippetsQuerySchema },
    async ({ session, query }) => {
      return NextResponse.json({
        snippets: await listSnippets({
          userId: session?.userId,
          q: query.q,
          language: query.language,
        }),
      });
    },
  );
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "snippet:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: createSnippetSchema,
    },
    async ({ session, body }) => {
      return NextResponse.json(
        { snippet: await createSnippet({ ...body, createdBy: session?.userId }) },
        { status: 201 },
      );
    },
  );
}

export async function PATCH(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "snippet:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: updateSnippetSchema,
    },
    async ({ session, body }) => {
      const { id, ...data } = body;
      const actor = {
        userId: session?.userId,
        canManageAll: session ? sessionHasPermission(session, "role:manage") : false,
      };
      try {
        return NextResponse.json({ snippet: await updateSnippet(id, data, actor) });
      } catch (err) {
        const message = err instanceof Error ? err.message : "更新失败";
        if (message.includes("无权")) return apiError({ status: 403, code: "PERMISSION_DENIED", message });
        if (message.includes("不存在")) return apiError({ status: 404, code: "NOT_FOUND", message });
        return apiError({ status: 400, code: "BUSINESS_RULE_FAILED", message });
      }
    },
  );
}

export async function DELETE(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "snippet:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      querySchema: deleteSnippetQuerySchema,
    },
    async ({ session, query }) => {
      const actor = {
        userId: session?.userId,
        canManageAll: session ? sessionHasPermission(session, "role:manage") : false,
      };
      try {
        await deleteSnippet(query.id, actor);
        return NextResponse.json({ success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "删除失败";
        if (message.includes("无权")) return apiError({ status: 403, code: "PERMISSION_DENIED", message });
        if (message.includes("不存在")) return apiError({ status: 404, code: "NOT_FOUND", message });
        return apiError({ status: 400, code: "BUSINESS_RULE_FAILED", message });
      }
    },
  );
}
