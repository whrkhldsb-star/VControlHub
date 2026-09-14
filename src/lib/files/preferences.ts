import { apiCopy } from "@/lib/i18n/api-copy";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { teamWhere } from "@/lib/auth/team-scope";
import type { SessionPayload } from "@/lib/auth/session";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

export const filePreferenceSchema = z.object({
  fileEntryId: z.string().min(1).max(128),
  favorite: z.boolean().optional(),
  tags: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(32)
        .regex(/^[^\x00-\x1f,]+$/),
    )
    .max(12)
    .transform((tags) => [...new Set(tags)])
    .optional(),
  opened: z.literal(true).optional(),
});

export async function updateFilePreference(
  session: SessionPayload,
  input: z.infer<typeof filePreferenceSchema>,
) {
  const entry = await prisma.fileEntry.findFirst({
    where: {
      id: input.fileEntryId,
      isDeleted: false,
      storageNode: teamWhere(session),
    },
    select: { storageNodeId: true, relativePath: true },
  });
  if (!entry) throw new NotFoundError(apiCopy("apiCopy.files.op.missing"));
  const access = await assertStorageAccess({
    session,
    ...entry,
    operation: "read",
  });
  if (!access.allowed)
    throw new ForbiddenError(apiCopy("apiCopy.files.op.access"));
  const data = {
    ...(input.favorite !== undefined ? { favorite: input.favorite } : {}),
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    ...(input.opened ? { lastOpenedAt: new Date() } : {}),
  };
  return prisma.filePreference.upsert({
    where: {
      userId_fileEntryId: {
        userId: session.userId,
        fileEntryId: input.fileEntryId,
      },
    },
    create: { userId: session.userId, fileEntryId: input.fileEntryId, ...data },
    update: data,
  });
}

export async function listFilePreferences(
  session: SessionPayload,
  input: {
    mode: "favorites" | "recent" | "tags" | "entry";
    tag?: string;
    fileEntryId?: string;
    cursor?: string;
  },
) {
  const rows = await prisma.filePreference.findMany({
    where: {
      userId: session.userId,
      fileEntry: { isDeleted: false, storageNode: teamWhere(session) },
      ...(input.mode === "favorites" ? { favorite: true } : {}),
      ...(input.mode === "recent" ? { lastOpenedAt: { not: null } } : {}),
      ...(input.mode === "tags"
        ? { tags: input.tag ? { has: input.tag } : { isEmpty: false } }
        : {}),
      ...(input.mode === "entry"
        ? { fileEntryId: input.fileEntryId ?? "" }
        : {}),
    },
    orderBy:
      input.mode === "recent"
        ? [{ lastOpenedAt: "desc" }, { fileEntryId: "asc" }]
        : [{ updatedAt: "desc" }, { fileEntryId: "asc" }],
    ...(input.cursor
      ? {
          cursor: {
            userId_fileEntryId: {
              userId: session.userId,
              fileEntryId: input.cursor,
            },
          },
          skip: 1,
        }
      : {}),
    take: 51,
    select: {
      favorite: true,
      tags: true,
      lastOpenedAt: true,
      fileEntryId: true,
      fileEntry: {
        select: {
          id: true,
          name: true,
          entryType: true,
          relativePath: true,
          storageNodeId: true,
          storageNode: { select: { name: true } },
        },
      },
    },
  });
  const page = rows.slice(0, 50);
  const visible = [];
  for (const row of page) {
    const access = await assertStorageAccess({
      session,
      storageNodeId: row.fileEntry.storageNodeId,
      relativePath: row.fileEntry.relativePath,
      operation: "read",
    });
    if (access.allowed) visible.push(row);
  }
  return {
    items: visible,
    nextCursor: rows.length > 50 ? page.at(-1)!.fileEntryId : null,
  };
}
