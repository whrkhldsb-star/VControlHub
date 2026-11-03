import { apiCopy } from "@/lib/i18n/api-copy";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getApiSession } from "@/lib/auth/api-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { hasBearerAuthorization, verifyBearerToken } from "@/lib/auth/bearer-token";
import { seesAllCustomers } from "@/lib/auth/team-scope";
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
        checksum: true,
        createdAt: true,
        mimeType: true,
        filename: true,
        isPublic: true,
        userId: true,
        teamId: true,
        team: { select: { deletedAt: true } },
      },
    });

    // A deleted customer is hidden with its data until restored: its public
    // links stop serving its images too.
    if (!image || image.team?.deletedAt) {
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
        (seesAllCustomers(session) ||
          (image.teamId !== null && image.teamId === session.currentTeamId));
      const canReadPrivateImage =
        !!session &&
        isInManagedTeam &&
        (session.userId === image.userId || sessionHasPermission(session, "media:manage") || sessionHasPermission(session, "team:manage"));

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

    // `?thumb=1` serves the WebP thumbnail the upload routes write beside the
    // original (A5-07); the grid used to load every original. Missing thumbnail
    // (older uploads, failed generation) falls back to the original.
    const wantsThumb = new URL(request.url).searchParams.get("thumb") === "1";
    const thumbPath = wantsThumb ? resolveUploadPath(`${image.storageKey.replace(/\.[^./]+$/, "")}_thumb.webp`) : null;
    let servedPath = filePath;
    let contentType = image.mimeType;
    let variant = "";
    let fileStat;
    if (thumbPath) {
      try {
        fileStat = await stat(thumbPath);
        servedPath = thumbPath;
        contentType = "image/webp";
        variant = "-thumb";
      } catch {
        fileStat = undefined;
      }
    }
    if (!fileStat) {
      try {
        fileStat = await stat(filePath);
      } catch {
        return apiError({
          code: "NOT_FOUND",
          message: apiCopy("apiCopy.file.is.missing.35456012"),
          status: 404,
        });
      }
    }

    // Validators (A5-09): a public image linked from a blog revalidates with
    // 304 instead of re-downloading on every visit.
    const etag = image.checksum ? `"${image.checksum}${variant}"` : `"${image.id}-${fileStat.size}${variant}"`;
    const createdAt = image.createdAt instanceof Date ? image.createdAt : null;
    const cacheHeaders: Record<string, string> = {
      "Cache-Control": image.isPublic ? "public, no-cache, must-revalidate" : "private, no-store",
      ETag: etag,
      ...(createdAt ? { "Last-Modified": createdAt.toUTCString() } : {}),
      Vary: "Authorization, Cookie",
    };
    const ifNoneMatch = request.headers.get("if-none-match");
    const ifModifiedSince = request.headers.get("if-modified-since");
    const etagMatches = ifNoneMatch !== null && ifNoneMatch.split(",").map((value) => value.trim().replace(/^W\//, "")).includes(etag);
    const notModifiedSince = !ifNoneMatch && createdAt !== null && ifModifiedSince !== null && Number.isFinite(Date.parse(ifModifiedSince)) && createdAt.getTime() <= Date.parse(ifModifiedSince) + 1000;
    if (etagMatches || notModifiedSince) {
      return new NextResponse(null, { status: 304, headers: cacheHeaders });
    }

    const webStream = nodeStreamToWeb(createReadStream(servedPath));

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileStat.size),
        ...cacheHeaders,
        "Content-Disposition": buildContentDisposition("inline", image.filename),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  });
}
