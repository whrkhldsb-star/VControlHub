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
      errorMessage: "Failed to load knowledge base",
    },
    async ({ session }) => {
      const { id } = await context.params;
      const base = await getKnowledgeBase(id, session!);
      if (!base) throw new NotFoundError("Knowledge base not found");
      return NextResponse.json({
        knowledgeBase: {
          id: base.id,
          name: base.name,
          description: base.description,
          isActive: base.isActive,
          documentCount: base._count.documents,
          chunkCount: base._count.chunks,
          documents: base.documents,
          updatedAt: base.updatedAt,
        },
      });
    },
  );
}
