/**
 * TR-009 55c: POST /api/images/upload/[id]/complete — finalize a chunked
 * upload session.
 *
 * URL params: id = MediaUploadSession.id
 * Body: empty (we assemble from disk).
 *
 * Behaviour:
 *   1. assembleMediaUploadChunks() reads all chunks from disk
 *   2. extract metadata + generate thumbnail + WebP + AVIF variants
 *   3. persist original + variants to UPLOAD_DIR + create ImageUpload row
 *   4. mark session COMPLETED with the new imageId as resultImageId
 *
 * Returns: { session: MediaUploadSessionView, image: { id, publicUrl } }
 * Permission: storage:write (session-based, owner-scoped via service).
 */
import * as crypto from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { IMAGE_UPLOAD_LIMIT } from "@/lib/http/rate-limit-presets";
import { UPLOAD_DIR } from "@/lib/image-bed/constants";
import {
  convertToAVIF,
  convertToWebP,
  extractMetadata,
  generateThumbnail,
} from "@/lib/image/service";
import { logError } from "@/lib/logging";
import { prisma } from "@/lib/db";
import {
  assembleMediaUploadChunks,
  completeMediaUploadSession,
  MediaUploadError,
} from "@/lib/upload/service";
import { auditUserAction } from "@/lib/audit/service";
import { ForbiddenError, ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

function generateStorageKey(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase() || ".png";
  return `${crypto.randomUUID()}${ext}`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: IMAGE_UPLOAD_LIMIT,
      errorStatus: 500,
      errorMessage: "Failed to complete upload session",
    },
    async ({ session }) => {
      if (!session) {
        throw new ForbiddenError("Not authenticated or session expired");
      }
      let assembled: Buffer;
      try {
        assembled = await assembleMediaUploadChunks(sessionId, session.userId);
      } catch (err) {
        if (err instanceof MediaUploadError) {
          throw new ValidationError(err.message, { code: err.code });
        }
        throw err;
      }

      // Resolve the session filename for storage key derivation.
      const existing = await prisma.mediaUploadSession.findFirst({
        where: { id: sessionId, userId: session.userId },
        select: { filename: true, mimeType: true },
      });
      if (!existing) {
        throw new ValidationError("Upload session not found or does not belong to the current user", {
          code: "session_not_found",
        });
      }
      const { filename, mimeType } = existing;

      // Mirror the single-shot /api/images/upload/route.ts pipeline.
      const storageKey = generateStorageKey(filename);
      const checksum = crypto
        .createHash("sha256")
        .update(assembled)
        .digest("hex");

      let imgWidth: number | null = null;
      let imgHeight: number | null = null;
      try {
        const meta = await extractMetadata(assembled);
        imgWidth = meta.width || null;
        imgHeight = meta.height || null;
      } catch {
        // sharp failure tolerated — single-shot upload does the same.
      }

      const ext = path.extname(storageKey).toLowerCase();
      const base = path.basename(storageKey, ext);
      const thumbName = `${base}_thumb.webp`;
      const originalPath = path.join(UPLOAD_DIR, storageKey);
      const thumbPath = path.join(UPLOAD_DIR, thumbName);
      const webpPath = path.join(UPLOAD_DIR, `${base}.webp`);
      const avifPath = path.join(UPLOAD_DIR, `${base}.avif`);

      await mkdir(UPLOAD_DIR, { recursive: true });

      const writtenPaths: string[] = [];
      try {
        await Promise.all([
          writeFile(originalPath, assembled).then(() => {
            writtenPaths.push(originalPath);
          }),
          (async () => {
            try {
              const thumb = await generateThumbnail(assembled);
              await writeFile(thumbPath, thumb);
              writtenPaths.push(thumbPath);
            } catch (err) {
              logError("media-upload:thumbnail-failed", err);
            }
          })(),
          (async () => {
            try {
              if (!mimeType.includes("webp")) {
                const webp = await convertToWebP(assembled);
                await writeFile(webpPath, webp);
                writtenPaths.push(webpPath);
              }
            } catch (err) {
              logError("media-upload:webp-failed", err);
            }
          })(),
          (async () => {
            try {
              if (!mimeType.includes("avif")) {
                const avif = await convertToAVIF(assembled);
                await writeFile(avifPath, avif);
                writtenPaths.push(avifPath);
              }
            } catch (err) {
              logError("media-upload:avif-failed", err);
            }
          })(),
        ]);
      } catch (err) {
        await Promise.allSettled(
          writtenPaths.map((filePath) => rm(filePath, { force: true })),
        );
        throw err;
      }

      let image;
      try {
        image = await prisma.imageUpload.create({
          data: {
            filename,
            storageKey,
            mimeType,
            sizeBytes: assembled.byteLength,
            width: imgWidth,
            height: imgHeight,
            checksum,
            isPublic: true,
            userId: session.userId,
          },
        });
      } catch (err) {
        await Promise.allSettled(
          writtenPaths.map((filePath) => rm(filePath, { force: true })),
        );
        throw err;
      }

      const view = await completeMediaUploadSession({
        sessionId,
        userId: session.userId,
        buffer: assembled,
        resultImageId: image.id,
      });

      await auditUserAction(
        session.userId,
        "media.upload.complete",
        {
          sessionId,
          imageId: image.id,
          sizeBytes: assembled.byteLength,
          filename,
          mimeType,
        },
        "INFO",
      );

      return NextResponse.json({
        session: view,
        image: {
          id: image.id,
          publicUrl: `/api/images/${image.id}/file`,
        },
      });
    },
  );
}
