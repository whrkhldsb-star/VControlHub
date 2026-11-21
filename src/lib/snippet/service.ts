import { createHash, randomUUID } from "node:crypto";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { isGlobalTeamManager, type TeamSession } from "@/lib/auth/team-scope";
import { t } from "@/lib/i18n/service-translations";

/** Who reads snippets: their customer and role decide which shared ones show. */
export type SnippetViewer = { userId: string; currentTeamId: string | null; platformAdmin: boolean };

export function snippetViewer(session: TeamSession): SnippetViewer {
  return { userId: session.userId, currentTeamId: session.currentTeamId ?? null, platformAdmin: isGlobalTeamManager(session) };
}

// Snippet has no ownership column. Its server-generated, immutable ID records
// the original sharing scope. Legacy CUIDs have no provable scope and only
// their owner and platform administrators can read them.
function teamSnippetPrefix(teamId: string) {
  return `sn-team-${createHash("sha256").update(teamId).digest("hex")}-`;
}

const PLATFORM_PREFIX = "sn-platform-";

function sharedSnippetWhere(viewer: SnippetViewer) {
  if (viewer.platformAdmin) return { isPrivate: false };
  const admin = { roles: { some: { role: { key: "admin" } } } };
  const teamId = viewer.currentTeamId;
  return {
    isPrivate: false,
    OR: [
      { id: { startsWith: PLATFORM_PREFIX }, creator: { is: admin } },
      ...(teamId ? [{
        id: { startsWith: teamSnippetPrefix(teamId) },
        creator: { is: { OR: [admin, { teamMembership: { is: { teamId } } }] } },
      }] : []),
    ],
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

export async function createSnippet(input: { title: string; content: string; language?: string; description?: string; tags?: string[]; isPrivate?: boolean; createdBy?: string }, viewer?: SnippetViewer) {
  requireNonBlank(input.title, t("backend.snippet.titleAndContentRequired"));
  requireNonBlank(input.content, t("backend.snippet.titleAndContentRequired"));
  const prefix = viewer?.currentTeamId ? teamSnippetPrefix(viewer.currentTeamId) : viewer?.platformAdmin ? PLATFORM_PREFIX : null;
  return prisma.snippet.create({
    data: {
      ...(prefix ? { id: prefix + randomUUID() } : {}),
      title: input.title.trim(),
      content: input.content,
      language: input.language?.trim() || "text",
      description: input.description?.trim() || null,
      tags: tags(input.tags),
      isPrivate: input.isPrivate ?? false,
      createdBy: viewer?.userId ?? input.createdBy ?? null,
    },
  });
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
  const visible = await prisma.snippet.findFirst({
    where: {
      id,
      ...(actor.platformAdmin && actor.canManageAll ? {} : { OR: [{ createdBy: actor.userId }, sharedSnippetWhere(actor)] }),
    },
  });
  if (!visible) throw new NotFoundError(t("backend.snippet.snippetNotFound"));
  return visible;
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
    requireNonBlank(input.title, t("backend.snippet.titleRequired"));
    data.title = input.title.trim();
  }
  if (input.content !== undefined) {
    requireNonBlank(input.content, t("backend.snippet.contentRequired"));
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
