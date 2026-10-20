import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { isGlobalTeamManager, type TeamSession } from "@/lib/auth/team-scope";
import { t } from "@/lib/i18n/service-translations";

/** Who reads snippets: their customer and role decide which shared ones show. */
export type SnippetViewer = { userId: string; currentTeamId: string | null; platformAdmin: boolean };

export function snippetViewer(session: TeamSession): SnippetViewer {
  return { userId: session.userId, currentTeamId: session.currentTeamId ?? null, platformAdmin: isGlobalTeamManager(session) };
}

/**
 * A snippet that is not private is shared within its creator's customer, and
 * a platform administrator's with everyone (as before). Unticking "visible
 * only to me" used to share a customer's snippet with every other customer.
 */
function sharedSnippetWhere(viewer: SnippetViewer) {
  if (viewer.platformAdmin) return { isPrivate: false };
  return {
    isPrivate: false,
    creator: {
      is: {
        OR: [
          { roles: { some: { role: { key: "admin" } } } },
          ...(viewer.currentTeamId ? [{ teamMembership: { is: { teamId: viewer.currentTeamId } } }] : []),
        ],
      },
    },
  };
}

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

const SNIPPET_LIST_PREVIEW_CHARS = 240;

export async function listSnippets(input: { viewer: SnippetViewer; q?: string; language?: string }) {
  const q = input.q?.trim();
  // Shared snippets the viewer's customer may see, plus their own private ones.
  const privacyFilter = { OR: [sharedSnippetWhere(input.viewer), { createdBy: input.viewer.userId }] };
  const rows = await prisma.snippet.findMany({
    take: 500,
    where: {
      AND: [
        input.language ? { language: input.language } : {},
        q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { content: { contains: q, mode: "insensitive" } },
                { tags: { has: q } },
              ],
            }
          : {},
        privacyFilter,
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      content: true,
      language: true,
      description: true,
      tags: true,
      isPrivate: true,
      createdBy: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  // List payload keeps a short preview only — full body is fetched on demand.
  return rows.map(({ content, ...rest }) => ({
    ...rest,
    contentPreview:
      content.length > SNIPPET_LIST_PREVIEW_CHARS
        ? `${content.slice(0, SNIPPET_LIST_PREVIEW_CHARS)}…`
        : content,
    contentLength: content.length,
  }));
}

export async function getSnippet(
  id: string,
  actor: SnippetViewer & { canManageAll?: boolean },
) {
  const existing = await prisma.snippet.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError(t("backend.snippet.snippetNotFound"));
  if (actor.canManageAll || existing.createdBy === actor.userId) return existing;
  if (existing.isPrivate) throw new ForbiddenError(t("backend.snippet.noPermissionToModifyOthersSnippets"));
  // Shared, but with another customer: as if it did not exist.
  const visible = await prisma.snippet.count({ where: { id, ...sharedSnippetWhere(actor) } });
  if (visible === 0) throw new NotFoundError(t("backend.snippet.snippetNotFound"));
  return existing;
}

export async function updateSnippet(
  id: string,
  input: { title?: string; content?: string; language?: string; description?: string; tags?: string[]; isPrivate?: boolean },
  actor?: { userId?: string | null; canManageAll?: boolean },
) {
  const existing = await prisma.snippet.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError(t("backend.snippet.snippetNotFound"));
  if (!canMutateSnippet(existing.createdBy, actor)) {
    throw new ForbiddenError(t("backend.snippet.noPermissionToModifyOthersSnippets"));
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
  if (!existing) throw new NotFoundError(t("backend.snippet.snippetNotFound"));
  if (!canMutateSnippet(existing.createdBy, actor)) {
    throw new ForbiddenError(t("backend.snippet.noPermissionToDeleteOthersSnippets"));
  }
  return prisma.snippet.delete({ where: { id } });
}
