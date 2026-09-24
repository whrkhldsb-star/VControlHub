import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { sessionHasPermission } from "@/lib/auth/authorization";
import type { SessionPayload } from "@/lib/auth/session";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createSnippet, deleteSnippet, getSnippet, listSnippets, updateSnippet } from "@/lib/snippet/service";
import {
  createSnippetSchema,
  deleteSnippetQuerySchema,
  listSnippetsQuerySchema,
  updateSnippetSchema,
} from "@/lib/snippet/schema";
import { z } from "zod";
import { auditUserAction } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

const snippetsGetQuerySchema = listSnippetsQuerySchema.extend({
  id: z.string().trim().min(1).optional(),
});

/**
 * Actor handed to the snippet service. `canManageAll` is gated on the far
 * narrower `role:manage`, never on this route's `snippet:manage` — that flag
 * is the override that lets someone edit/delete other people's snippets.
 */
function snippetActor(session: SessionPayload) {
  return {
    userId: session.userId,
    canManageAll: sessionHasPermission(session, "role:manage"),
  };
}

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "snippet:manage", querySchema: snippetsGetQuerySchema },
    async ({ session, query }) => {
      if (query.id) {
        const snippet = await getSnippet(query.id, snippetActor(session));
        return NextResponse.json({ snippet });
      }
      return NextResponse.json({
        snippets: await listSnippets({
        userId: session.userId,
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
      const snippet = await createSnippet({ ...body, createdBy: session.userId });
      await auditUserAction(session.userId, "snippet.create", { snippetId: snippet.id }, undefined, session.currentTeamId);
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
      // AppErrors (Forbidden/NotFound/Validation) bubble to withApiRoute's
      // apiCatch, which maps each type to its status — do not string-match
      // English messages (messages are not stable error codes).
      const snippet = await updateSnippet(id, data, snippetActor(session));
      await auditUserAction(session.userId, "snippet.update", { snippetId: id }, undefined, session.currentTeamId);
      return NextResponse.json({ snippet });
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
      await deleteSnippet(query.id, snippetActor(session));
      await auditUserAction(session.userId, "snippet.delete", { snippetId: query.id }, undefined, session.currentTeamId);
      return NextResponse.json({ success: true });
    },
  );
}
