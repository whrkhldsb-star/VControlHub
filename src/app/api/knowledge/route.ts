/**
 * GET    /api/knowledge                 — list knowledge bases
 * POST   /api/knowledge                 — create base | ingest doc | search
 * DELETE /api/knowledge?id=             — delete base
 * DELETE /api/knowledge?documentId=     — delete document
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeDocument,
  ingestKnowledgeDocument,
  listKnowledgeBases,
  searchKnowledge,
} from "@/lib/ai/knowledge";
import { auditUserAction } from "@/lib/audit/service";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { GENERAL_READ_LIMIT, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { ValidationError } from "@/lib/errors";

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_base"),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal("ingest"),
    knowledgeBaseId: z.string().trim().min(1),
    title: z.string().trim().min(1).max(200),
    content: z.string().min(1).max(200_000),
    sourceType: z.enum(["TEXT", "MARKDOWN", "NOTE"]).optional(),
  }),
  z.object({
    action: z.literal("search"),
    query: z.string().trim().min(1).max(500),
    knowledgeBaseId: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(8).optional(),
  }),
]);

export async function GET(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "ai:chat",
      rateLimit: GENERAL_READ_LIMIT,
      errorMessage: "Failed to list knowledge bases",
    },
    async ({ session }) => {
      const bases = await listKnowledgeBases(session!);
      return NextResponse.json({
        knowledgeBases: bases.map((b) => ({
          id: b.id,
          name: b.name,
          description: b.description,
          isActive: b.isActive,
          documentCount: b._count.documents,
          chunkCount: b._count.chunks,
          updatedAt: b.updatedAt,
          creator: b.creator,
        })),
      });
    },
  );
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      // create_base/ingest require ai:manage; search stays ai:chat.
      permission: "ai:chat",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: postSchema,
      errorMessage: "Knowledge action failed",
    },
    async ({ session, body }) => {
      // create_base/ingest require ai:manage; search only needs ai:chat.
      if (body.action === "create_base" || body.action === "ingest") {
        if (!sessionHasPermission(session!, "ai:manage")) {
          return NextResponse.json(
            { error: "Insufficient permissions to manage knowledge base" },
            { status: 403 },
          );
        }
      }
      if (body.action === "create_base") {
        const base = await createKnowledgeBase({
          name: body.name,
          description: body.description,
          session: session!,
        });
        await auditUserAction(session!.userId, "knowledge.base.create", {
          knowledgeBaseId: base.id,
          name: base.name,
        });
        return NextResponse.json({ knowledgeBase: base }, { status: 201 });
      }

      if (body.action === "ingest") {
        const result = await ingestKnowledgeDocument({
          knowledgeBaseId: body.knowledgeBaseId,
          title: body.title,
          content: body.content,
          sourceType: body.sourceType,
          session: session!,
        });
        await auditUserAction(session!.userId, "knowledge.document.ingest", {
          knowledgeBaseId: body.knowledgeBaseId,
          documentId: result.document.id,
          chunkCount: result.chunkCount,
        });
        return NextResponse.json(
          {
            document: result.document,
            chunkCount: result.chunkCount,
          },
          { status: 201 },
        );
      }

      // search
      const hits = await searchKnowledge({
        query: body.query,
        knowledgeBaseId: body.knowledgeBaseId,
        limit: body.limit,
        session: session!,
      });
      return NextResponse.json({ hits, count: hits.length });
    },
  );
}

export async function DELETE(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "ai:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "Knowledge delete failed",
    },
    async ({ session }) => {
      const { id, documentId } = parseSearchParams(
        request,
        z.object({
          id: z.string().trim().min(1).optional(),
          documentId: z.string().trim().min(1).optional(),
        }),
      );
      if (documentId) {
        const result = await deleteKnowledgeDocument(documentId, session!);
        await auditUserAction(session!.userId, "knowledge.document.delete", {
          documentId: result.id,
        }, undefined, session?.currentTeamId);
        return NextResponse.json({ success: true, documentId: result.id });
      }
      if (!id) throw new ValidationError("id or documentId is required");
      const result = await deleteKnowledgeBase(id, session!);
      await auditUserAction(session!.userId, "knowledge.base.delete", {
        knowledgeBaseId: result.id,
      }, undefined, session?.currentTeamId);
      return NextResponse.json({ success: true, id: result.id });
    },
  );
}
