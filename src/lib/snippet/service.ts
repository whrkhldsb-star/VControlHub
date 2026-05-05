import { prisma } from "@/lib/db";

function tags(input?: string[]) { return Array.from(new Set((input ?? []).map((t) => t.trim()).filter(Boolean))).slice(0, 20); }

export async function createSnippet(input: { title: string; content: string; language?: string; description?: string; tags?: string[]; isPrivate?: boolean; createdBy?: string }) {
  if (!input.title.trim() || !input.content.trim()) throw new Error("代码片段标题和内容不能为空");
  return prisma.snippet.create({ data: { title: input.title.trim(), content: input.content, language: input.language?.trim() || "text", description: input.description?.trim() || null, tags: tags(input.tags), isPrivate: input.isPrivate ?? false, createdBy: input.createdBy ?? null } });
}

export async function listSnippets(input: { userId?: string; q?: string; language?: string } = {}) {
  const q = input.q?.trim();
  return prisma.snippet.findMany({
    where: { AND: [input.language ? { language: input.language } : {}, q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { content: { contains: q, mode: "insensitive" } }, { tags: { has: q } }] } : {}, { OR: [{ isPrivate: false }, input.userId ? { createdBy: input.userId } : {}] }] },
    orderBy: { updatedAt: "desc" },
  });
}
