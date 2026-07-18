import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createSnippet, deleteSnippet, listSnippets, updateSnippet } from "@/lib/snippet/service";
import {
  createSnippetSchema,
  deleteSnippetQuerySchema,
  listSnippetsQuerySchema,
  updateSnippetSchema,
} from "@/lib/snippet/schema";
import { auditUserAction } from "@/lib/audit/service";
import { apiCatch } from "@/lib/http/api-error";

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
      const snippet = await createSnippet({ ...body, createdBy: session?.userId });
      await auditUserAction(session?.userId ?? "", "snippet.create", { snippetId: snippet.id }, undefined, session?.currentTeamId);
      return NextResponse.json(
        { snippet },
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
        const snippet = await updateSnippet(id, data, actor);
        await auditUserAction(session?.userId ?? "", "snippet.update", { snippetId: id }, undefined, session?.currentTeamId);
        return NextResponse.json({ snippet });
      } catch (err) {
        // AppError (Forbidden/NotFound/Validation) must map to status — do not
        // string-match English messages (messages are not stable error codes).
        return apiCatch(err);
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
        await auditUserAction(session?.userId ?? "", "snippet.delete", { snippetId: query.id }, undefined, session?.currentTeamId);
        return NextResponse.json({ success: true });
      } catch (err) {
        return apiCatch(err);
      }
    },
  );
}
