import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * GET /api/knowledge/[id] — knowledge base detail + documents
 */
import { NextResponse } from "next/server";

import { getKnowledgeBase } from "@/lib/ai/knowledge";
import { NotFoundError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "ai:chat",
      rateLimit: GENERAL_READ_LIMIT,
      errorMessage: apiCopy("apiCopy.failed.to.load.knowledge.base.1f5f8377"),
    },
    async ({ session }) => {
      const { id } = await context.params;
      const offset = Number.parseInt(new URL(request.url).searchParams.get("offset") ?? "0", 10);
      const documentOffset = Number.isFinite(offset) && offset > 0 ? offset : 0;
      const base = await getKnowledgeBase(id, session, documentOffset);
      if (!base) throw new NotFoundError(apiCopy("apiCopy.knowledge.base.not.found.0ac936d8"));
      return NextResponse.json({
        knowledgeBase: {
          id: base.id,
          name: base.name,
          description: base.description,
          isActive: base.isActive,
          documentCount: base._count.documents,
          chunkCount: base._count.chunks,
          documents: base.documents,
          // Older documents still answer searches: the list must reach them.
          documentsOffset: documentOffset,
          documentsHasMore: documentOffset + base.documents.length < base._count.documents,
          updatedAt: base.updatedAt,
        },
      });
    },
  );
}
