import { NextResponse } from "next/server";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { verifyBearerToken } from "@/lib/auth/bearer-token";
import { withCacheHeaders, CachePresets } from "@/lib/cache";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";

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
    { requireAuth: true, errorMessage: "获取图片列表失败" },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: "未登录或会话已过期" },
          { status: 401 },
        );
      return listImages(
        request,
        session.userId,
        sessionHasPermission(session, "user:read"),
      );
    },
  );
}

async function listImages(request: Request, userId: string, isAdmin: boolean) {
  const { searchParams } = new URL(request.url);

  const album = searchParams.get("album")?.trim() || undefined;
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(
    100,
    Math.max(1, Number(searchParams.get("limit")) || 30),
  );
  const showAll = searchParams.get("all") === "true";

  const where: Record<string, unknown> = {};
  if (album) where.album = album;

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
    CachePresets.shortLived,
  );
}
