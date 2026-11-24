import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { escapeLikeLiteral } from "@/lib/db/like-pattern";
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

const TEAM_PREFIX = "sn-team-";
const PLATFORM_PREFIX = "sn-platform-";
/** Upper bound on archived customers excluded by prefix in the all-customers view. */
const MAX_ARCHIVED_TEAM_EXCLUSIONS = 5_000;

/** A platform admin in "all customers" mode (same rule as `seesAllCustomers`). */
function viewerSeesAllCustomers(viewer: SnippetViewer) {
  return viewer.platformAdmin && !viewer.currentTeamId;
}

/**
 * Which snippets the viewer may see (D6-02):
 * - all-customers platform admin: every shared snippet plus their own, minus archived customers' snippets;
 * - otherwise: platform-shared snippets, shared snippets of the current live customer, and their own
 *   snippets only when they belong to that live customer, to the platform (platform admins only) or are
 *   unscoped legacy rows. A transferred or demoted author no longer reaches their old scope's snippets.
 */
async function snippetScopeWhere(viewer: SnippetViewer): Promise<Prisma.SnippetWhereInput> {
  if (viewerSeesAllCustomers(viewer)) {
    const archived = await prisma.team.findMany({
      where: { deletedAt: { not: null } },
      select: { id: true },
      take: MAX_ARCHIVED_TEAM_EXCLUSIONS,
    });
    return {
      OR: [{ isPrivate: false }, { createdBy: viewer.userId }],
      ...(archived.length ? { NOT: archived.map((team) => ({ id: { startsWith: teamSnippetPrefix(team.id) } })) } : {}),
    };
  }
  const liveTeam = viewer.currentTeamId
    ? await prisma.team.findFirst({ where: { id: viewer.currentTeamId, deletedAt: null }, select: { id: true } })
    : null;
  const teamId = liveTeam?.id ?? null;
  const teamPrefix = teamId ? teamSnippetPrefix(teamId) : null;
  const admin = { roles: { some: { role: { key: "admin" } } } };
  return {
    OR: [
      { isPrivate: false, id: { startsWith: PLATFORM_PREFIX }, creator: { is: admin } },
      ...(teamId && teamPrefix ? [{
        isPrivate: false,
        id: { startsWith: teamPrefix },
        creator: { is: { OR: [admin, { teamMembership: { is: { teamId } } }] } },
      }] : []),
      {
        createdBy: viewer.userId,
        OR: [
          ...(teamPrefix ? [{ id: { startsWith: teamPrefix } }] : []),
          ...(viewer.platformAdmin ? [{ id: { startsWith: PLATFORM_PREFIX } }] : []),
          { NOT: [{ id: { startsWith: TEAM_PREFIX } }, { id: { startsWith: PLATFORM_PREFIX } }] },
        ],
      },
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
  actor?: MutationActor,
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
  // Literal search (D6-04): `%`, `_` and a trailing `\` are text, not LIKE syntax.
  const needle = q ? escapeLikeLiteral(q) : "";
  // Shared snippets the viewer's customer may see, plus their own ones in scope.
  const privacyFilter = await snippetScopeWhere(input.viewer);
  return prisma.$transaction(async tx => {
    const rows = await tx.snippet.findMany({
      take: 500,
      where: {
        AND: [
          input.language ? { language: input.language } : {},
          q
            ? {
                OR: [
                  { title: { contains: needle, mode: "insensitive" } },
                  { description: { contains: needle, mode: "insensitive" } },
                  { content: { contains: needle, mode: "insensitive" } },
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
        language: true,
        description: true,
        tags: true,
        isPrivate: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!rows.length) return [];
    const previews = await tx.$queryRaw<{ id: string; preview: string; length: number }[]>`
      SELECT id, left(content, ${SNIPPET_LIST_PREVIEW_CHARS}) AS preview,
        char_length(content) + char_length(regexp_replace(content COLLATE "C", '[^\u{10000}-\u{10ffff}]+', '', 'g')) AS length
      FROM snippets WHERE id IN (${Prisma.join(rows.map(row => row.id))})`;
    const byId = new Map(previews.map(row => [row.id, row]));
    return rows.map(row => {
      const { preview, length } = byId.get(row.id)!;
      return { ...row, contentPreview: length > SNIPPET_LIST_PREVIEW_CHARS ? preview.slice(0, SNIPPET_LIST_PREVIEW_CHARS) + "…" : preview, contentLength: length };
    });
  }, { isolationLevel: "RepeatableRead" });
}

type MutationActor = Partial<SnippetViewer> & { canManageAll?: boolean };

async function visibleSnippet(id: string, actor?: MutationActor): Promise<Prisma.SnippetWhereInput> {
  const viewer = { userId: actor?.userId ?? "", currentTeamId: actor?.currentTeamId ?? null, platformAdmin: actor?.platformAdmin ?? false };
  // The management override reaches every snippet only from the all-customers view.
  if (viewerSeesAllCustomers(viewer) && actor?.canManageAll) return { id };
  return { id, AND: [await snippetScopeWhere(viewer)] };
}

export async function getSnippet(
  id: string,
  actor: SnippetViewer & { canManageAll?: boolean },
) {
  const visible = await prisma.snippet.findFirst({
    where: await visibleSnippet(id, actor),
  });
  if (!visible) throw new NotFoundError(t("backend.snippet.snippetNotFound"));
  return visible;
}

export async function updateSnippet(
  id: string,
  input: { title?: string; content?: string; language?: string; description?: string; tags?: string[]; isPrivate?: boolean },
  actor?: MutationActor,
) {
  const existing = await prisma.snippet.findFirst({ where: await visibleSnippet(id, actor) });
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

export async function deleteSnippet(id: string, actor?: MutationActor) {
  const existing = await prisma.snippet.findFirst({ where: await visibleSnippet(id, actor) });
  if (!existing) throw new NotFoundError(t("backend.snippet.snippetNotFound"));
  if (!canMutateSnippet(existing.createdBy, actor)) {
    throw new ForbiddenError(t("backend.snippet.noPermissionToDeleteOthersSnippets"));
  }
  return prisma.snippet.delete({ where: { id } });
}
