import { apiCopy } from "@/lib/i18n/api-copy";
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
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { IMAGE_UPLOAD_LIMIT } from "@/lib/http/rate-limit-presets";
import { UPLOAD_DIR } from "@/lib/image-bed/constants";
import { indexLinkedStorageImage } from "@/lib/image-bed/linked-storage";
import {
  canonicalImageMime,
  convertToAVIF,
  convertToWebP,
  extractMetadata,
  generateThumbnail,
  MAX_IMAGE_PIXELS,
} from "@/lib/image/service";
import { logError } from "@/lib/logging";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import {
  assembleMediaUploadChunks,
  completeMediaUploadSession,
  cleanupMediaUploadTempDir,
  MediaUploadError,
} from "@/lib/upload/service";
import { auditUserAction } from "@/lib/audit/service";
import { beginUploadFinalization, recordFinalizationFailure } from "@/lib/upload/finalization-lease";
import { UploadOutcomeUnknownError, ForbiddenError, ValidationError } from "@/lib/errors";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { MAX_IMAGE_UPLOAD_BYTES } from "@/lib/upload/types";
import { assertStorageAccess, releaseStorageQuotaGuard } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import {
  storageFileNodeSelect,
  writeStorageFileBuffer,
  type StorageFileNode,
} from "@/lib/storage/file-content";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;
	const locale = await getServerLocale();
  let storageAccess: Awaited<ReturnType<typeof assertStorageAccess>> | undefined;
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: IMAGE_UPLOAD_LIMIT,
      errorStatus: 500,
      errorMessage: apiCopy("apiCopy.failed.to.complete.upload.session.dae9f71c"),
    },
    async ({ session }) => {
      // Reject legacy sessions created before the image-specific cap without
      // assembling their chunks into memory.
      const existing = await prisma.mediaUploadSession.findFirst({
        where: { id: sessionId, userId: session.userId },
        select: {
          filename: true,
          mimeType: true,
          totalSize: true,
          storageNodeId: true,
          relativePath: true,
          status: true,
          expiresAt: true,
          totalChunks: true,
          receivedChunks: true,
        },
      });
      if (!existing) {
        throw new ValidationError(apiCopy("apiCopy.upload.session.not.found.or.does.not.belong.to.the.current.user.134b524c"), {
          code: "session_not_found",
        });
      }
      if (Number(existing.totalSize) > MAX_IMAGE_UPLOAD_BYTES) {
        throw new ValidationError(
          apiCopy("apiCopy.image.upload.exceeds.bytes.fdabc347", { v0: String(MAX_IMAGE_UPLOAD_BYTES) }),
          { code: "total_size_too_large" },
        );
      }

      if (!["PENDING", "UPLOADING"].includes(existing.status) || existing.expiresAt.getTime() <= Date.now()) {
        throw new ValidationError(t("backend.storage.uploadSessionNotActive", locale), { code: "session_not_active" });
      }
      const received = new Set(existing.receivedChunks);
      if (received.size !== existing.totalChunks || Array.from({ length: existing.totalChunks }, (_, index) => index).some((index) => !received.has(index))) {
        throw new ValidationError(t("backend.storage.chunksMissing", locale), { code: "chunks_incomplete" });
      }
      // Freeze the chunks before reading or decoding them. This update and a
      // concurrent chunk replacement acquire the same PostgreSQL row lock.
      const lease = await beginUploadFinalization(sessionId, session.userId);

      try {
      let assembled: Buffer;
      try {
        assembled = await assembleMediaUploadChunks(sessionId, session.userId, { requireFinalizing: true });
      } catch (err) {
        if (err instanceof MediaUploadError) {
          throw new ValidationError(err.message, { code: err.code });
        }
        throw err;
      }
      if (assembled.byteLength > MAX_IMAGE_UPLOAD_BYTES) {
        throw new ValidationError(
          apiCopy("apiCopy.image.upload.exceeds.bytes.fdabc347", { v0: String(MAX_IMAGE_UPLOAD_BYTES) }),
          { code: "total_size_too_large" },
        );
      }

      const { filename } = existing;

      // Mirror the single-shot /api/images/upload/route.ts pipeline.
      const checksum = crypto
        .createHash("sha256")
        .update(assembled)
        .digest("hex");

      let imgWidth: number | null = null;
      let imgHeight: number | null = null;
      let detectedMime = "application/octet-stream";
      let detectedFormat: string;
      try {
        const meta = await extractMetadata(assembled);
				if (!meta.format || meta.format === "svg" || meta.width <= 0 || meta.height <= 0) throw new Error("Invalid image dimensions or format");
        // Decompression-bomb guard (see single-shot route). Reject gigapixel
        // dimensions with a clear message before running the variant encoders.
        if (meta.width * meta.height > MAX_IMAGE_PIXELS) {
          throw new ValidationError(t("api.image.dimensionsTooLarge", locale));
        }
        imgWidth = meta.width || null;
        imgHeight = meta.height || null;
        // Persist sharp's byte-sniffed MIME, not the session-declared type.
        detectedMime = canonicalImageMime(meta.format);
        detectedFormat = meta.format;
      } catch (err) {
				if (err instanceof ValidationError) throw err;
				throw new ValidationError(t("api.image.invalidImage", locale));
      }

      // Match the direct upload path: variants must never overwrite the original.
      const storageKey = `${crypto.randomUUID()}.${detectedFormat}`;
      const ext = path.extname(storageKey).toLowerCase();
      const base = path.basename(storageKey, ext);
      const thumbName = `${base}_thumb.webp`;
      const originalPath = path.join(UPLOAD_DIR, storageKey);
      const thumbPath = path.join(UPLOAD_DIR, thumbName);
      const webpPath = path.join(UPLOAD_DIR, `${base}.webp`);
      const avifPath = path.join(UPLOAD_DIR, `${base}.avif`);

      let linkedStorageRelativePath: string | null = null;
      let linkedStorageNode: StorageFileNode | null = null;
      if (existing.storageNodeId && existing.relativePath) {
        storageAccess = await assertStorageAccess({ session, storageNodeId: existing.storageNodeId, relativePath: existing.relativePath, operation: "write", writeBytes: assembled.byteLength });
        if (!storageAccess.allowed) throw new ForbiddenError(storageAccessDeniedCopy(storageAccess.reason));
        const node = await prisma.storageNode.findFirst({ where: { id: existing.storageNodeId, ...teamWhere(session) }, select: storageFileNodeSelect });
        if (!node || (node.driver !== "LOCAL" && node.driver !== "SFTP")) throw new ValidationError(apiCopy("apiCopy.storage.node.does.not.support.media.uploads.0d4e9d55"));
        linkedStorageNode = node;
        linkedStorageRelativePath = `${existing.relativePath.replace(/\/$/, "")}/${storageKey}`;
      }
      await lease.beforeWrite({ kind: "image", storageKey, checksum, paths: [originalPath, thumbPath, webpPath, avifPath], storageNodeId: existing.storageNodeId, relativePath: linkedStorageRelativePath });
      await mkdir(UPLOAD_DIR, { recursive: true });

      {
        const [originalResult] = await Promise.allSettled([
          writeFile(originalPath, assembled),
          (async () => {
            try {
              const thumb = await generateThumbnail(assembled);
              await writeFile(thumbPath, thumb);
            } catch (err) {
              logError("media-upload:thumbnail-failed", err);
            }
          })(),
          (async () => {
            try {
              if (!detectedMime.includes("webp")) {
                const webp = await convertToWebP(assembled);
                await writeFile(webpPath, webp);
              }
            } catch (err) {
              logError("media-upload:webp-failed", err);
            }
          })(),
          (async () => {
            try {
              if (!detectedMime.includes("avif")) {
                const avif = await convertToAVIF(assembled);
                await writeFile(avifPath, avif);
              }
            } catch (err) {
              logError("media-upload:avif-failed", err);
            }
          })(),
        ]);
        if (originalResult.status === "rejected") throw originalResult.reason;
      }

      if (linkedStorageNode && linkedStorageRelativePath) {
        await lease.assertActive();
        await writeStorageFileBuffer(linkedStorageNode, linkedStorageRelativePath, assembled);
      }

      await lease.assertActive();
      const result = await prisma.$transaction(async (tx) => {
        const image = await tx.imageUpload.create({
          data: {
            filename,
            storageKey,
            mimeType: detectedMime,
            sizeBytes: assembled.byteLength,
            width: imgWidth,
            height: imgHeight,
            checksum,
            isPublic: false,
            storageNodeId: linkedStorageRelativePath ? existing.storageNodeId : undefined,
            relativePath: linkedStorageRelativePath || undefined,
            userId: session.userId,
            teamId: session.currentTeamId ?? null,
          },
        });
        if (linkedStorageRelativePath && existing.storageNodeId) {
          await indexLinkedStorageImage({
            storageNodeId: existing.storageNodeId,
            relativePath: linkedStorageRelativePath,
            originalName: filename,
            mimeType: detectedMime,
            size: assembled.byteLength,
            checksum,
          }, tx);
        }
        const view = await completeMediaUploadSession({
          sessionId,
          userId: session.userId,
          buffer: assembled,
          resultImageId: image.id,
          allowedStatuses: ["FINALIZING"],
          transaction: tx,
          finalizationToken: lease.token,
        });
        return { image, view };
        });

      const { image, view } = result;
      await cleanupMediaUploadTempDir(sessionId).catch((error) => {
        logError("media-upload:cleanup-failed", error);
      });

      await auditUserAction(
        session.userId,
        "media.upload.complete",
        {
          sessionId,
          imageId: image.id,
          sizeBytes: assembled.byteLength,
          filename,
          mimeType: detectedMime,
        },
        "INFO",
        session.currentTeamId,
      );

      return NextResponse.json({
        session: view,
        image: {
          id: image.id,
          publicUrl: `/api/images/${image.id}/file`,
        },
      });
      } catch (error) {
        const failure = await recordFinalizationFailure(lease);
        if (failure.changed && !failure.review) await cleanupMediaUploadTempDir(sessionId).catch((err) => logError("media-upload:cleanup-failed", err));
        if (failure.review) throw new UploadOutcomeUnknownError(t("backend.storage.uploadOutcomeUnknown"));
        throw error;
      } finally {
        lease.stop();
      }
    },
  ).finally(() => releaseStorageQuotaGuard(storageAccess));
}
