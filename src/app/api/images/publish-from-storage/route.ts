import { canonicalImageMime } from "@/lib/image/service";
import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * Publish a file from storage node to image bed.
 * POST /api/images/publish-from-storage
 * Body: { storageNodeId, relativePath, filename?, album? }
 */
import * as crypto from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { NextResponse } from "next/server";
import { z } from "zod";

import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { IMAGE_UPLOAD_LIMIT } from "@/lib/http/rate-limit-presets";
import { UPLOAD_DIR } from "@/lib/image-bed/constants";
import { logError } from "@/lib/logging";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { assertNotRecycled } from "@/lib/storage/archive-access";
import { statBackingObject } from "@/lib/storage/fs-backend";
import { readStorageFileBuffer, storageFileNodeSelect } from "@/lib/storage/file-content";
import { IMAGE_EXTENSIONS } from "@/lib/storage/mime-constants";
import { extractMetadata, generateThumbnail } from "@/lib/image/service";

import { ForbiddenError, ValidationError } from "@/lib/errors";
import { getServerLocale, t } from "@/lib/i18n/translations";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const BLOCKED_IMAGE_EXTENSIONS = new Set([".svg", ".svgz"]);
const publishSchema = z.object({
  storageNodeId: z.string().min(1),
  relativePath: z.string().min(1),
  filename: z.string().optional(),
  album: z.string().optional(),
});


const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
  "image/tiff": ".tiff",
  "image/bmp": ".bmp",
  "image/heif": ".heif",
};
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    {
      // It creates an image, as an upload does: image:write, plus read access
      // to the source path (checked below, with storage:read). Gated by
      // storage:read alone, a read-only role added images to the image bed.
      permission: "image:write",
      rateLimit: IMAGE_UPLOAD_LIMIT,
      errorMessage: apiCopy("apiCopy.failed.to.publish.from.storage.b1d93bfc"),
      bodySchema: publishSchema,
    },
    async ({ session, body }) => {
      const { storageNodeId, relativePath, filename, album } = body;

      // Verify the storage node exists, is in team scope, and is a supported driver.
      const storageNode = await prisma.storageNode.findFirst({
        where: { id: storageNodeId, ...teamWhere(session) },
        select: storageFileNodeSelect,
      });
      if (!storageNode) {
        return NextResponse.json(
          { error: apiCopy("apiCopy.storage.node.not.found.3b3ec488") },
          { status: 404 },
        );
      }
      if (storageNode.driver !== "LOCAL" && storageNode.driver !== "SFTP") {
        return NextResponse.json(
          { error: apiCopy("apiCopy.only.local.or.sftp.storage.nodes.are.supported.9b2a16c9") },
          { status: 400 },
        );
      }

      const ext = path.extname(relativePath).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext) || BLOCKED_IMAGE_EXTENSIONS.has(ext))
        return NextResponse.json(
          { error: apiCopy("apiCopy.unsupported.file.type.c24bdea9") },
          { status: 400 },
        );

      const readAccess = await assertStorageAccess({
        session,
        storageNodeId,
        relativePath,
        operation: "read",
      });
      if (!readAccess.allowed) {
        // The reason is a code ("no_access"); it was sent to the client as the message.
        throw new ForbiddenError(storageAccessDeniedCopy(readAccess.reason));
      }
      // A file in the recycle bin keeps its bytes at its path: publishing it handed a teammate's deleted image
      // a new, possibly public, life on the image bed.
      await assertNotRecycled(storageNodeId, relativePath);

      // Size pre-check BEFORE buffering the file: reading a multi-GB storage
      // object into memory only to reject it over the cap would OOM the route.
      // statBackingObject is metadata-only (fs.stat / sftp.stat).
      const sourceStat = await statBackingObject({
        storageNode,
        relativePath,
      });
      if (sourceStat && sourceStat.size > MAX_IMAGE_BYTES) {
        throw new ValidationError(t("api.image.fileTooLarge", locale));
      }

      // Read file from storage after the exact storage path has been authorized.
      const buffer = await readStorageFileBuffer(storageNode, relativePath);
      if (buffer.byteLength > MAX_IMAGE_BYTES) {
        throw new ValidationError(t("api.image.fileTooLarge", locale));
      }
      let metadata;
      try {
        metadata = await extractMetadata(buffer);
        if (!metadata.format || metadata.format === "svg" || metadata.width <= 0 || metadata.height <= 0) {
          throw new Error("Invalid image dimensions or format");
        }
      } catch {
        throw new ValidationError(t("api.image.invalidImage", locale));
      }
      const originalName = filename || path.basename(relativePath);
      // The sniffed format decides the type and the key, as the upload routes do
      // (A5-10): a misnamed JPEG was served as image/png by its extension.
      const detectedMime = canonicalImageMime(metadata.format);
      const detectedExt = IMAGE_EXTENSION_BY_MIME[detectedMime] ?? ext;
      const storageKey = `${crypto.randomUUID()}${detectedExt}`;
      const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

      // Check for duplicate within the caller's tenant only (never leak other teams' rows), and only among images
      // the caller may see: their own, or public ones — another member's private image is not theirs to reuse.
      const existing = await prisma.imageUpload.findFirst({
        where: {
          checksum,
          ...(session.currentTeamId
            ? { teamId: session.currentTeamId, OR: [{ userId: session.userId }, { isPublic: true }] }
            : { userId: session.userId }),
        },
      });
      if (existing) {
        return NextResponse.json({
          image: existing,
          publicUrl: `/api/images/${existing.id}/file`,
          message: apiCopy("apiCopy.file.already.exists.checksum.matched.skipping.upload.e8e53f41"),
        });
      }

      // Save to image-bed directory before creating the index row. If the DB
      // write fails, compensate by deleting the just-written served file so the
      // API cannot return upload failure while leaving an orphan public object.
      await mkdir(UPLOAD_DIR, { recursive: true });
      const imagePath = path.join(UPLOAD_DIR, storageKey);
      await writeFile(imagePath, buffer);
      // The thumbnail the grid asks for with ?thumb=1, as the upload routes write it. Without one, every tile of a
      // published image loaded its original (up to 20 MB). Best-effort: the image is published either way.
      const thumbPath = path.join(UPLOAD_DIR, `${path.basename(storageKey, detectedExt)}_thumb.webp`);
      let thumbWritten = false;
      try {
        await writeFile(thumbPath, await generateThumbnail(buffer));
        thumbWritten = true;
      } catch (thumbError) {
        logError("image-bed:publish-from-storage-thumbnail", thumbError);
        await rm(thumbPath, { force: true }).catch(() => undefined);
      }

      // Create DB record
      let image;
      try {
        image = await prisma.imageUpload.create({
          data: {
            filename: originalName,
            storageKey,
            mimeType: detectedMime,
            sizeBytes: buffer.byteLength,
            width: metadata.width,
            height: metadata.height,
            checksum,
            album: album?.trim() || undefined,
            isPublic: false,
            storageNodeId,
            relativePath,
            userId: session.userId,
            teamId: session.currentTeamId ?? null,
          },
        });
      } catch (error) {
        await Promise.all([imagePath, ...(thumbWritten ? [thumbPath] : [])].map((written) =>
          rm(written, { force: true }).catch((cleanupError) => {
            logError("image-bed:publish-from-storage-cleanup", cleanupError);
          }),
        ));
        throw error;
      }

      return NextResponse.json(
        {
          image,
          publicUrl: `/api/images/${image.id}/file`,
        },
        { status: 201 },
      );
    },
  );
}
