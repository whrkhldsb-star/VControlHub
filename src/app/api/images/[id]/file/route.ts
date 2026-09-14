import { apiCopy } from "@/lib/i18n/api-copy";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getApiSession } from "@/lib/auth/api-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { hasBearerAuthorization, verifyBearerToken } from "@/lib/auth/bearer-token";
import { isGlobalTeamManager } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { UPLOAD_DIR } from "@/lib/image-bed/constants";

import { apiError } from "@/lib/http/api-error";
import { withApiRoute } from "@/lib/http/api-guard";
import { buildContentDisposition } from "@/lib/http/content-disposition";
import { nodeStreamToWeb } from "@/lib/http/node-to-web-stream";
export const dynamic = "force-dynamic";

function resolveUploadPath(storageKey: string) {
  const uploadRoot = path.resolve(UPLOAD_DIR);
  const filePath = path.resolve(uploadRoot, storageKey);
  if (
    filePath !== uploadRoot &&
    filePath.startsWith(`${uploadRoot}${path.sep}`)
  ) {
    return filePath;
  }
  return null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(request, {}, async () => {
    const { id } = await params;

    const image = await prisma.imageUpload.findUnique({
      where: { id },
      select: {
        id: true,
        storageKey: true,
        mimeType: true,
        filename: true,
        isPublic: true,
        userId: true,
        teamId: true,
      },
    });

    if (!image) {
      return NextResponse.json(
        { error: apiCopy("apiCopy.image.not.found.or.inaccessible.034fcf62") },
        { status: 404 },
      );
    }

    if (!image.isPublic) {
      const bearerRequested = hasBearerAuthorization(request);
      const tokenAuth = bearerRequested
        ? await verifyBearerToken(request, "image:read")
        : null;
      const session = tokenAuth?.session ??
        (bearerRequested ? null : await getApiSession());
      // Owner, or team/media managers — not every holder of image:read (list own library).
      const isInManagedTeam =
        !!session &&
        (isGlobalTeamManager(session) ||
          (image.teamId !== null && image.teamId === session.currentTeamId));
      const canReadPrivateImage =
        !!session &&
        (session.userId === image.userId ||
          (isInManagedTeam &&
            (sessionHasPermission(session, "media:manage") ||
              sessionHasPermission(session, "team:manage"))));

      if (!canReadPrivateImage) {
        return NextResponse.json(
          { error: apiCopy("apiCopy.image.not.found.or.inaccessible.034fcf62") },
          { status: 404 },
        );
      }
    }

    const filePath = resolveUploadPath(image.storageKey);
    if (!filePath) {
      return apiError({
        code: "VALIDATION_FAILED",
        message: apiCopy("apiCopy.invalid.file.path.5659e6b3"),
        status: 400,
      });
    }

    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      return apiError({
        code: "NOT_FOUND",
        message: apiCopy("apiCopy.file.is.missing.35456012"),
        status: 404,
      });
    }

    const webStream = nodeStreamToWeb(createReadStream(filePath));

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": image.mimeType,
        "Content-Length": String(fileStat.size),
        "Cache-Control": image.isPublic
          ? "public, no-cache, must-revalidate"
          : "private, no-store",
        "Content-Disposition": buildContentDisposition("inline", image.filename),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  });
}
