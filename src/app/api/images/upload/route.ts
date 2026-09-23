import * as crypto from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { NextResponse } from "next/server";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { hasBearerAuthorization } from "@/lib/auth/bearer-token";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
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
import { assertStorageAccess, releaseStorageQuotaGuard } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import {
  deleteStorageFileBuffer,
  storageFileNodeSelect,
  writeStorageFileBuffer,
  type StorageFileNode,
} from "@/lib/storage/file-content";
import type { SessionPayload } from "@/lib/auth/session";

import { AppError, ForbiddenError, ValidationError, isAppError } from "@/lib/errors";
import { getServerLocale, t, type Locale } from "@/lib/i18n/translations";
import { requestContentLengthExceeds, requestContentLengthMissing } from "@/lib/http/request-body";
import { MAX_IMAGE_UPLOAD_BYTES } from "@/lib/upload/types";
export const dynamic = "force-dynamic";
const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
// image/* minus SVG: SVG served inline can execute script (stored XSS).
const ALLOWED_MIME_PREFIXES = ["image/"];
const BLOCKED_MIME_TYPES = new Set(["image/svg+xml", "image/svg"]);
const BLOCKED_EXTENSIONS = new Set([".svg", ".svgz"]);

function computeChecksum(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

type UploadFile = {
  arrayBuffer(): Promise<ArrayBuffer>;
  name?: string;
  type?: string;
  size?: number;
};

function isUploadFile(v: unknown): v is UploadFile {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as UploadFile).arrayBuffer === "function"
  );
}

export async function POST(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    { permission: "image:write", rateLimit: IMAGE_UPLOAD_LIMIT, errorMessage: t("api.image.uploadFailed", locale) },
    async ({ session }) => {
      // Direct Token uploads only require image:write; linked storage below
      // still checks the scoped session's storage permission and quota.
      if (!hasBearerAuthorization(request) && !sessionHasPermission(session, "storage:write")) {
        throw new ForbiddenError(t("api.storage.writeDenied", locale));
      }
      return handleUpload(request, session.userId, session, locale);
    },
  );
}

async function handleUpload(request: Request, userId: string, session: SessionPayload | undefined, locale: Locale) {
  let storageAccess: Awaited<ReturnType<typeof assertStorageAccess>> | undefined;
  try {
    if (
      requestContentLengthExceeds(
        request,
        MAX_IMAGE_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD_BYTES,
      )
    ) {
      return NextResponse.json(
        { error: t("api.image.fileTooLarge", locale) },
        { status: 413 },
      );
    }
    // No declared length means request.formData() would buffer a chunked body
    // of unknown size into memory before the size check below — reject up front.
    if (requestContentLengthMissing(request)) {
      return NextResponse.json(
        { error: t("api.image.fileTooLarge", locale) },
        { status: 411 },
      );
    }
    const formData = await request.formData();
    const file = formData.get("file");
    const album = String(formData.get("album") ?? "").trim() || undefined;
    const storageNodeId =
      String(formData.get("storageNodeId") ?? "").trim() || undefined;
    const relativePath =
      String(formData.get("relativePath") ?? "").trim() || undefined;

    if (!isUploadFile(file)) {
      throw new ValidationError(t("api.storage.missingUploadFile", locale));
    }

    const mimeType = file.type || "application/octet-stream";
    const originalNameEarly = file.name || "upload.bin";
    const extEarly = path.extname(originalNameEarly).toLowerCase();
    if (
      BLOCKED_MIME_TYPES.has(mimeType.toLowerCase()) ||
      BLOCKED_EXTENSIONS.has(extEarly)
    ) {
      throw new ValidationError(t("api.image.svgBlocked", locale));
    }
    if (!ALLOWED_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) {
      throw new ValidationError(t("api.image.onlyImages", locale));
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_UPLOAD_BYTES) {
      throw new ValidationError(t("api.image.fileTooLarge", locale));
    }

    const originalName = file.name || "untitled.png";
    const checksum = computeChecksum(buffer);

    // Decode with sharp before persisting. MIME and extension are caller
    // controlled and must not turn arbitrary bytes into inline-served content.
    let imgWidth: number | null = null;
    let imgHeight: number | null = null;
    let detectedMime = "application/octet-stream";
    let detectedFormat: string;
    try {
      const meta = await extractMetadata(buffer);
			if (!meta.format || meta.format === "svg" || meta.width <= 0 || meta.height <= 0) throw new Error("Invalid image dimensions or format");
      // Decompression-bomb guard: a small file can carry gigapixel dimensions.
      // sharp's openImage() already caps decode, but reject here with a clear
      // message before we run it three more times for the variants.
      if (meta.width * meta.height > MAX_IMAGE_PIXELS) {
        throw new ValidationError(t("api.image.dimensionsTooLarge", locale));
      }
      imgWidth = meta.width || null;
      imgHeight = meta.height || null;
      // Trust sharp's byte-sniffed format for the stored MIME, never the
      // client-supplied Content-Type (which could spoof a benign type).
      detectedMime = canonicalImageMime(meta.format);
      detectedFormat = meta.format;
    } catch (error) {
			if (error instanceof ValidationError) throw error;
			throw new ValidationError(t("api.image.invalidImage", locale));
    }

    // Client extensions can collide with generated variants (PNG named .webp).
    // Keep the display filename, but store the original under its decoded format.
    const storageKey = `${crypto.randomUUID()}.${detectedFormat}`;

    // Ensure upload directory exists
    const uploadDir = UPLOAD_DIR;
    await mkdir(uploadDir, { recursive: true });

    const writtenPaths: string[] = [];

    // Save original + generate thumbnail + WebP/AVIF variants
    const ext = path.extname(storageKey).toLowerCase();
    const base = path.basename(storageKey, ext);
    const thumbName = `${base}_thumb.webp`;
    const originalPath = path.join(uploadDir, storageKey);
    const thumbPath = path.join(uploadDir, thumbName);
    const webpPath = path.join(uploadDir, `${base}.webp`);
    const avifPath = path.join(uploadDir, `${base}.avif`);

    // The original write is the record of truth; the three variants are
    // best-effort. Use allSettled so a failed variant never rejects the whole
    // batch, then check the original explicitly: if IT failed, any variants
    // that did land are orphans (no DB row will point at them) — remove them
    // and surface the error instead of leaving files behind.
    const [originalResult] = await Promise.allSettled([
      writeFile(originalPath, buffer).then(() => {
        writtenPaths.push(originalPath);
      }),
      // Generate thumbnail (best-effort)
      (async () => {
        try {
          const thumb = await generateThumbnail(buffer);
          await writeFile(thumbPath, thumb);
          writtenPaths.push(thumbPath);
        } catch {
          /* best-effort */
        }
      })(),
      // Generate WebP variant (best-effort)
      (async () => {
        try {
          if (!detectedMime.includes("webp")) {
            const webp = await convertToWebP(buffer);
            await writeFile(webpPath, webp);
            writtenPaths.push(webpPath);
          }
        } catch {
          /* best-effort */
        }
      })(),
      // Generate AVIF variant (best-effort)
      (async () => {
        try {
          if (!detectedMime.includes("avif")) {
            const avif = await convertToAVIF(buffer);
            await writeFile(avifPath, avif);
            writtenPaths.push(avifPath);
          }
        } catch {
          /* best-effort */
        }
      })(),
    ]);

    if (originalResult.status === "rejected") {
      await Promise.allSettled(writtenPaths.map((filePath) => rm(filePath, { force: true })));
      throw originalResult.reason;
    }

    let linkedStorageRelativePath: string | null = null;
    let linkedStorageNode: StorageFileNode | null = null;

    // If linked to a storage node, also copy there (cloud storage integration)
    if (storageNodeId && relativePath) {
      try {
        if (!session) {
          throw new ForbiddenError(t("api.image.storageCopyForbidden", locale));
        }
        storageAccess = await assertStorageAccess({
          session,
          storageNodeId,
          relativePath,
          operation: "write",
          writeBytes: buffer.byteLength,
        });
        if (!storageAccess.allowed) {
          throw new ForbiddenError(storageAccessDeniedCopy(storageAccess.reason, locale));
        }
        const storageNode = await prisma.storageNode.findFirst({
          where: { id: storageNodeId, ...teamWhere(session) },
          select: storageFileNodeSelect,
        });
        if (!storageNode || (storageNode.driver !== "LOCAL" && storageNode.driver !== "SFTP")) {
          throw new ValidationError(t("backend.storage.uploadNotSupported", locale));
        }
        linkedStorageRelativePath = `${relativePath.replace(/\/$/, "")}/${storageKey}`;
        linkedStorageNode = storageNode;
        await writeStorageFileBuffer(storageNode, linkedStorageRelativePath, buffer);
      } catch (error) {
        logError("image-bed:cloud-copy-failed", error);
        await Promise.allSettled([
          ...writtenPaths.map((filePath) => rm(filePath, { force: true })),
          linkedStorageNode && linkedStorageRelativePath
            ? deleteStorageFileBuffer(linkedStorageNode, linkedStorageRelativePath).catch((cleanupErr) => {
                logError("image-bed:linked-storage-rollback-failed", cleanupErr);
              })
            : Promise.resolve(),
        ]);
        throw error;
      }
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
          width: imgWidth,
          height: imgHeight,
          checksum,
          album,
          isPublic: false,
          storageNodeId: linkedStorageRelativePath && storageNodeId ? storageNodeId : undefined,
          relativePath: linkedStorageRelativePath || undefined,
          userId: userId,
          teamId: session?.currentTeamId ?? null,
        },
      });
      if (linkedStorageRelativePath && storageNodeId) {
        await indexLinkedStorageImage({
          storageNodeId,
          relativePath: linkedStorageRelativePath,
          originalName,
          mimeType: detectedMime,
          size: buffer.byteLength,
          checksum,
        });
      }
    } catch (error) {
      await Promise.allSettled([
        image?.id
          ? prisma.imageUpload.delete({ where: { id: image.id } })
          : Promise.resolve(),
        ...writtenPaths.map((filePath) => rm(filePath, { force: true })),
        linkedStorageNode && linkedStorageRelativePath
          ? deleteStorageFileBuffer(linkedStorageNode, linkedStorageRelativePath).catch((cleanupErr) => {
              logError("image-bed:linked-storage-rollback-failed", cleanupErr);
            })
          : Promise.resolve(),
      ]);
      throw error;
    }

    const publicUrl = `/api/images/${image.id}/file`;

    return NextResponse.json(
      {
        ...image,
        publicUrl,
      },
      { status: 201 },
    );
  } catch (error) {
    if (isAppError(error)) {
      throw error;
    }
    logError("image-bed:upload", error);
    throw new AppError({ code: "INTERNAL_ERROR", message: t("api.image.uploadFailed", locale), status: 500 });
  } finally {
    // Quota readers must see the committed FileEntry, or completed rollback.
    if (storageAccess) await releaseStorageQuotaGuard(storageAccess);
  }
}
