import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";
import { z } from "zod";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { hasBearerAuthorization } from "@/lib/auth/bearer-token";
import { imageTeamWhere, type TeamSession } from "@/lib/auth/team-scope";
import { withCacheHeaders, CachePresets } from "@/lib/cache";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "image:read", errorMessage: apiCopy("apiCopy.failed.to.fetch.image.list.c85269a9") },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: apiCopy("apiCopy.not.authenticated.or.session.expired.b1714d99") },
          { status: 401 },
        );
      // showAll must not use broad user:read (many roles have it).
      // Only global team managers or media managers may list everyone's images.
      // media:manage is still team-scoped (not fleet-wide) via teamWhere.
      const canListAll =
        !hasBearerAuthorization(request) && (
          sessionHasPermission(session, "team:manage") ||
          sessionHasPermission(session, "media:manage")
        );
      return listImages(request, session.userId, canListAll, session);
    },
  );
}

async function listImages(
  request: Request,
  userId: string,
  canListAll: boolean,
  session: TeamSession | null,
) {
  const { album, q, page, limit, all: showAll } = parseSearchParams(
    request,
    z.object({
      album: z.string().trim().min(1).optional(),
      q: z.string().trim().min(1).optional(),
      page: z.coerce.number().int().min(1).max(1_000_000).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(30),
      all: z
        .string()
        .optional()
        .transform((value) => value === "true"),
    }),
  );

  const where: Record<string, unknown> = {};
  if (album) where.album = album;
  if (q) {
    where.OR = [
      { filename: { contains: q, mode: "insensitive" } },
      { relativePath: { contains: q, mode: "insensitive" } },
      { album: { contains: q, mode: "insensitive" } },
    ];
  }

  // Own images only unless showAll + elevated role.
  if (!showAll || !canListAll) {
    where.userId = userId;
  } else if (session) {
    Object.assign(where, imageTeamWhere(session));
  }

  const result = await prisma.$transaction(async (tx) => {
    const total = await tx.imageUpload.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const currentPage = Math.min(page, totalPages);
    const images = await tx.imageUpload.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (currentPage - 1) * limit,
      take: limit,
      include: {
        user: { select: { id: true, username: true, displayName: true } },
        storageNode: {
          select: {
            id: true,
            name: true,
            driver: true,
            server: { select: { name: true } },
          },
        },
      },
    });
    return { images, total, page: currentPage, totalPages };
  }, { isolationLevel: "RepeatableRead" });

  const imagesWithUrl = result.images.map((img) => ({
    ...img,
    publicUrl: `/api/images/${img.id}/file`,
  }));

  return withCacheHeaders(
    NextResponse.json({
      images: imagesWithUrl,
      total: result.total,
      page: result.page,
      limit,
      totalPages: result.totalPages,
    }),
    CachePresets.noStore,
  );
}
