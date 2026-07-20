/**
 * Knowledge Base / RAG — chunking + lexical retrieval.
 *
 * Design (pragmatic, production-safe):
 * - Documents are chunked into overlapping windows (~800 chars / ~120 overlap)
 * - Retrieval ranks chunks by keyword coverage + phrase boost (no external vector DB)
 * - Results are injected into AI chat as grounded context and exposed as a hosted tool
 * - Team scope applied when session has currentTeamId
 */
import { createHash } from "node:crypto";

import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { BusinessError, NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/translations";

const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_CHUNK_OVERLAP = 120;
const MAX_DOCUMENT_CHARS = 200_000;
const MAX_QUERY_CHARS = 500;
const MAX_RESULTS = 8;

export type KnowledgeHit = {
  chunkId: string;
  documentId: string;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  score: number;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\t/g, " ").replace(/[ \u00a0]+/g, " ").trim();
}

export function hashKnowledgeContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function estimateTokens(text: string): number {
  // rough: CJK ~1 token/char, latin ~1 token/4 chars
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const rest = Math.max(0, text.length - cjk);
  return cjk + Math.ceil(rest / 4);
}

export function chunkKnowledgeText(
  content: string,
  options?: { size?: number; overlap?: number },
): Array<{ chunkIndex: number; content: string; tokenEstimate: number; searchText: string }> {
  const size = options?.size ?? DEFAULT_CHUNK_SIZE;
  const overlap = options?.overlap ?? DEFAULT_CHUNK_OVERLAP;
  const text = normalizeWhitespace(content);
  if (!text) return [];

  const chunks: Array<{
    chunkIndex: number;
    content: string;
    tokenEstimate: number;
    searchText: string;
  }> = [];

  // Prefer splitting on paragraph boundaries when possible
  const paragraphs = text.split(/\n{2,}/);
  let buffer = "";
  let index = 0;

  const flush = (piece: string) => {
    const body = piece.trim();
    if (!body) return;
    if (body.length <= size) {
      chunks.push({
        chunkIndex: index++,
        content: body,
        tokenEstimate: estimateTokens(body),
        searchText: body.toLowerCase(),
      });
      return;
    }
    let start = 0;
    while (start < body.length) {
      const end = Math.min(body.length, start + size);
      const slice = body.slice(start, end).trim();
      if (slice) {
        chunks.push({
          chunkIndex: index++,
          content: slice,
          tokenEstimate: estimateTokens(slice),
          searchText: slice.toLowerCase(),
        });
      }
      if (end >= body.length) break;
      start = Math.max(0, end - overlap);
    }
  };

  for (const para of paragraphs) {
    const candidate = buffer ? `${buffer}\n\n${para}` : para;
    if (candidate.length <= size) {
      buffer = candidate;
      continue;
    }
    if (buffer) flush(buffer);
    buffer = para;
  }
  if (buffer) flush(buffer);

  return chunks;
}

function tokenizeQuery(query: string): string[] {
  const normalized = query.toLowerCase().trim();
  if (!normalized) return [];
  // Keep CJK bigrams + latin words
  const tokens = new Set<string>();
  for (const word of normalized.split(/[^a-z0-9_\u3400-\u9fff]+/i)) {
    const w = word.trim();
    if (w.length >= 2) tokens.add(w);
  }
  // CJK bigrams from continuous runs
  const cjkRuns = normalized.match(/[\u3400-\u9fff]{2,}/g) || [];
  for (const run of cjkRuns) {
    for (let i = 0; i < run.length - 1; i++) {
      tokens.add(run.slice(i, i + 2));
    }
  }
  return Array.from(tokens).slice(0, 24);
}

export function scoreChunkAgainstQuery(searchText: string, query: string, tokens: string[]): number {
  const q = query.toLowerCase().trim();
  if (!q || !searchText) return 0;
  let score = 0;
  if (searchText.includes(q)) score += 12;
  for (const token of tokens) {
    if (!token) continue;
    if (searchText.includes(token)) {
      score += token.length >= 4 ? 3 : 2;
      // density bonus
      let idx = 0;
      let hits = 0;
      while (hits < 5) {
        const found = searchText.indexOf(token, idx);
        if (found < 0) break;
        hits += 1;
        idx = found + token.length;
      }
      score += Math.max(0, hits - 1);
    }
  }
  return score;
}

export async function listKnowledgeBases(
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
) {
  return prisma.knowledgeBase.findMany({
    where: {
      isActive: true,
      ...(session ? teamWhere(session) : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      _count: { select: { documents: true, chunks: true } },
      creator: { select: { username: true, displayName: true } },
    },
  });
}

export async function createKnowledgeBase(input: {
  name: string;
  description?: string;
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;
}) {
  const name = input.name.trim();
  if (!name) throw new ValidationError(t("backend.ai.knowledgeBaseNameIsRequired"));
  if (name.length > 120) throw new ValidationError(t("backend.ai.nameIsTooLong"));
  return prisma.knowledgeBase.create({
    data: {
      name,
      description: input.description?.trim() || null,
      createdBy: input.session?.userId ?? null,
      teamId: input.session?.currentTeamId ?? null,
    },
  });
}

export async function getKnowledgeBase(
  id: string,
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
) {
  return prisma.knowledgeBase.findFirst({
    where: {
      id,
      ...(session ? teamWhere(session) : {}),
    },
    include: {
      documents: {
        orderBy: { updatedAt: "desc" },
        take: 100,
        select: {
          id: true,
          title: true,
          sourceType: true,
          status: true,
          chunkCount: true,
          contentHash: true,
          createdAt: true,
          updatedAt: true,
          errorMessage: true,
        },
      },
      _count: { select: { documents: true, chunks: true } },
    },
  });
}

export async function deleteKnowledgeBase(
  id: string,
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
) {
  const existing = await getKnowledgeBase(id, session);
  if (!existing) throw new NotFoundError(t("backend.ai.knowledgeBaseNotFound"));
  await prisma.knowledgeBase.delete({ where: { id } });
  return { id };
}

async function reindexDocument(documentId: string) {
  const doc = await prisma.knowledgeDocument.findUnique({ where: { id: documentId } });
  if (!doc) throw new NotFoundError(t("backend.ai.documentNotFound"));

  const chunks = chunkKnowledgeText(doc.content);
  await prisma.$transaction(async (tx) => {
    await tx.knowledgeChunk.deleteMany({ where: { documentId } });
    if (chunks.length > 0) {
      await tx.knowledgeChunk.createMany({
        data: chunks.map((chunk) => ({
          knowledgeBaseId: doc.knowledgeBaseId,
          documentId,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          tokenEstimate: chunk.tokenEstimate,
          searchText: chunk.searchText,
        })),
      });
    }
    await tx.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        status: "READY",
        errorMessage: null,
        chunkCount: chunks.length,
      },
    });
  });
  return chunks.length;
}

export async function ingestKnowledgeDocument(input: {
  knowledgeBaseId: string;
  title: string;
  content: string;
  sourceType?: "TEXT" | "MARKDOWN" | "NOTE";
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;
}) {
  const kb = await getKnowledgeBase(input.knowledgeBaseId, input.session);
  if (!kb) throw new NotFoundError(t("backend.ai.knowledgeBaseNotFound"));
  if (!kb.isActive) throw new BusinessError(t("backend.ai.knowledgeBaseIsInactive"));

  const title = input.title.trim();
  const content = input.content.replace(/\0/g, "");
  if (!title) throw new ValidationError(t("backend.ai.documentTitleIsRequired"));
  if (!content.trim()) throw new ValidationError(t("backend.ai.documentContentIsRequired"));
  if (content.length > MAX_DOCUMENT_CHARS) {
    throw new ValidationError(`Document exceeds ${MAX_DOCUMENT_CHARS} characters`);
  }

  const contentHash = hashKnowledgeContent(content);
  const doc = await prisma.knowledgeDocument.create({
    data: {
      knowledgeBaseId: input.knowledgeBaseId,
      title: title.slice(0, 200),
      sourceType: input.sourceType ?? "TEXT",
      content,
      contentHash,
      status: "PENDING",
      createdBy: input.session?.userId ?? null,
    },
  });

  try {
    const chunkCount = await reindexDocument(doc.id);
    const ready = await prisma.knowledgeDocument.findUnique({ where: { id: doc.id } });
    return { document: ready!, chunkCount };
  } catch (error) {
    await prisma.knowledgeDocument.update({
      where: { id: doc.id },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : "Indexing failed",
      },
    });
    throw error;
  }
}

export async function deleteKnowledgeDocument(
  documentId: string,
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
) {
  const doc = await prisma.knowledgeDocument.findUnique({
    where: { id: documentId },
    include: { knowledgeBase: true },
  });
  if (!doc) throw new NotFoundError(t("backend.ai.documentNotFound"));
  if (session) {
    const scoped = await getKnowledgeBase(doc.knowledgeBaseId, session);
    if (!scoped) throw new NotFoundError(t("backend.ai.documentNotFound"));
  }
  await prisma.knowledgeDocument.delete({ where: { id: documentId } });
  return { id: documentId };
}

export async function searchKnowledge(input: {
  query: string;
  knowledgeBaseId?: string;
  limit?: number;
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;
}): Promise<KnowledgeHit[]> {
  const query = input.query.trim().slice(0, MAX_QUERY_CHARS);
  if (!query) return [];
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0 && query.length < 2) return [];

  const bases = await prisma.knowledgeBase.findMany({
    where: {
      isActive: true,
      ...(input.knowledgeBaseId ? { id: input.knowledgeBaseId } : {}),
      ...(input.session ? teamWhere(input.session) : {}),
    },
    select: { id: true, name: true },
    take: 50,
  });
  if (bases.length === 0) return [];
  const baseIds = bases.map((b) => b.id);
  const baseName = new Map(bases.map((b) => [b.id, b.name]));

  // Pull a candidate pool with simple SQL ILIKE filters for at least one token
  const orFilters = tokens.slice(0, 8).map((token) => ({
    searchText: { contains: token.toLowerCase() },
  }));
  if (orFilters.length === 0) {
    orFilters.push({ searchText: { contains: query.toLowerCase().slice(0, 40) } });
  }

  const candidates = await prisma.knowledgeChunk.findMany({
    where: {
      knowledgeBaseId: { in: baseIds },
      OR: orFilters,
    },
    include: {
      document: { select: { id: true, title: true, status: true } },
    },
    take: 200,
    orderBy: { createdAt: "desc" },
  });

  const ranked: KnowledgeHit[] = [];
  for (const chunk of candidates) {
    if (chunk.document.status !== "READY") continue;
    const score = scoreChunkAgainstQuery(chunk.searchText, query, tokens);
    if (score <= 0) continue;
    ranked.push({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      knowledgeBaseId: chunk.knowledgeBaseId,
      knowledgeBaseName: baseName.get(chunk.knowledgeBaseId) ?? "Knowledge",
      documentTitle: chunk.document.title,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      score,
    });
  }

  ranked.sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex);
  const limit = Math.min(MAX_RESULTS, Math.max(1, input.limit ?? 5));
  return ranked.slice(0, limit);
}

export function formatKnowledgeContext(hits: KnowledgeHit[]): string {
  if (hits.length === 0) return "";
  const blocks = hits.map((hit, i) => {
    return `[KB${i + 1}] ${hit.knowledgeBaseName} / ${hit.documentTitle}#${hit.chunkIndex}\n${hit.content}`;
  });
  return [
    "You have access to the following knowledge base excerpts. Prefer them when answering operational questions. Cite sources as [KB#].",
    ...blocks,
  ].join("\n\n");
}

export async function buildKnowledgeContextForPrompt(input: {
  query: string;
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;
  knowledgeBaseId?: string;
  limit?: number;
}): Promise<{ context: string; hits: KnowledgeHit[] }> {
  const hits = await searchKnowledge({
    query: input.query,
    session: input.session,
    knowledgeBaseId: input.knowledgeBaseId,
    limit: input.limit ?? 5,
  });
  return { context: formatKnowledgeContext(hits), hits };
}
