import { NextResponse } from "next/server";
import { z } from "zod";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { verifyBearerToken } from "@/lib/auth/bearer-token";
import { withCacheHeaders, CachePresets } from "@/lib/cache";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const tokenAuth = await verifyBearerToken(request, "image:read");
  if (tokenAuth) {
    return listImages(
      request,
      tokenAuth.userId,
      tokenAuth.scopes.includes("admin"),
    );
  }

  return withApiRoute(
    request,
    { permission: "image:read", errorMessage: "Failed to fetch image list" },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: "Not authenticated or session expired" },
          { status: 401 },
        );
      // showAll must not use broad user:read (many roles have it).
      // Only global team managers or media managers may list everyone's images.
      const canListAll =
        sessionHasPermission(session, "team:manage") ||
        sessionHasPermission(session, "media:manage");
      return listImages(request, session.userId, canListAll);
    },
  );
}

async function listImages(request: Request, userId: string, isAdmin: boolean) {
  const { album, q, page, limit, all: showAll } = parseSearchParams(
    request,
    z.object({
      album: z.string().trim().min(1).optional(),
      q: z.string().trim().min(1).optional(),
      page: z.coerce.number().int().min(1).default(1),
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

  // Non-admin users only see their own images
  if (!showAll || !isAdmin) {
    where.userId = userId;
  }

  const [images, total] = await Promise.all([
    prisma.imageUpload.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
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
    }),
    prisma.imageUpload.count({ where }),
  ]);

  const imagesWithUrl = images.map((img) => ({
    ...img,
    publicUrl: `/api/images/${img.id}/file`,
  }));

  return withCacheHeaders(
    NextResponse.json({
      images: imagesWithUrl,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }),
    CachePresets.noStore,
  );
}
