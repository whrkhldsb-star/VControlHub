import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/db";

function tags(input?: string[]) {
  return Array.from(new Set((input ?? []).map((t) => t.trim()).filter(Boolean))).slice(0, 20);
}

function requireNonBlank(value: string, message: string) {
  if (!value.trim()) throw new ValidationError(message);
}

function canMutateSnippet(
  ownerId: string | null,
  actor?: { userId?: string | null; canManageAll?: boolean },
) {
  if (actor?.canManageAll) return true;
  return Boolean(ownerId && actor?.userId && ownerId === actor.userId);
}

export async function createSnippet(input: { title: string; content: string; language?: string; description?: string; tags?: string[]; isPrivate?: boolean; createdBy?: string }) {
  requireNonBlank(input.title, "Snippet title and content cannot be empty");
  requireNonBlank(input.content, "Snippet title and content cannot be empty");
  return prisma.snippet.create({ data: { title: input.title.trim(), content: input.content, language: input.language?.trim() || "text", description: input.description?.trim() || null, tags: tags(input.tags), isPrivate: input.isPrivate ?? false, createdBy: input.createdBy ?? null } });
}

export async function listSnippets(input: { userId?: string; q?: string; language?: string } = {}) {
 const q = input.q?.trim();
 return prisma.snippet.findMany({ take: 500,
  where: { AND: [input.language ? { language: input.language } : {}, q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { content: { contains: q, mode: "insensitive" } }, { tags: { has: q } }] } : {}, { OR: [{ isPrivate: false }, input.userId ? { createdBy: input.userId } : {}] }] },
  orderBy: { updatedAt: "desc" },
  select: { id: true, title: true, content: true, language: true, description: true, tags: true, isPrivate: true, createdBy: true, createdAt: true, updatedAt: true },
 });
}

export async function updateSnippet(
  id: string,
  input: { title?: string; content?: string; language?: string; description?: string; tags?: string[]; isPrivate?: boolean },
  actor?: { userId?: string | null; canManageAll?: boolean },
) {
  const existing = await prisma.snippet.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Snippet not found");
  if (!canMutateSnippet(existing.createdBy, actor)) {
    throw new ForbiddenError("No permission to modify others' snippets");
  }
  const data: Record<string, unknown> = {};
  if (input.title !== undefined) {
    requireNonBlank(input.title, "Snippet title cannot be empty");
    data.title = input.title.trim();
  }
  if (input.content !== undefined) {
    requireNonBlank(input.content, "Snippet content cannot be empty");
    data.content = input.content;
  }
  if (input.language !== undefined) data.language = input.language.trim() || "text";
  if (input.description !== undefined) data.description = input.description?.trim() || null;
  if (input.tags !== undefined) data.tags = tags(input.tags);
  if (input.isPrivate !== undefined) data.isPrivate = input.isPrivate;
  if (Object.keys(data).length === 0) return existing;
  return prisma.snippet.update({ where: { id }, data });
}

export async function deleteSnippet(id: string, actor?: { userId?: string | null; canManageAll?: boolean }) {
  const existing = await prisma.snippet.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Snippet not found");
  if (!canMutateSnippet(existing.createdBy, actor)) {
    throw new ForbiddenError("No permission to delete others' snippets");
  }
  return prisma.snippet.delete({ where: { id } });
}
