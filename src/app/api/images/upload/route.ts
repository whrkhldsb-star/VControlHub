import * as crypto from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { NextResponse } from "next/server";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { verifyBearerToken } from "@/lib/auth/bearer-token";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import {
  IMAGE_UPLOAD_LIMIT,
  rateLimitResponse,
  withRateLimit,
} from "@/lib/http/rate-limit-presets";
import { UPLOAD_DIR } from "@/lib/image-bed/constants";
import { indexLinkedStorageImage } from "@/lib/image-bed/linked-storage";
import {
  convertToAVIF,
  convertToWebP,
  extractMetadata,
  generateThumbnail,
} from "@/lib/image/service";
import { logError } from "@/lib/logging";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { writeStorageFileBuffer, storageFileNodeSelect } from "@/lib/storage/file-content";
import type { SessionPayload } from "@/lib/auth/session";

import { AppError, ForbiddenError, ValidationError } from "@/lib/errors";
export const dynamic = "force-dynamic";
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const ALLOWED_MIME_PREFIXES = ["image/"];

function generateStorageKey(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase() || ".png";
  return `${crypto.randomUUID()}${ext}`;
}

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
  const rl = await withRateLimit(request, IMAGE_UPLOAD_LIMIT);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  const tokenAuth = await verifyBearerToken(request, "image:write");
  if (tokenAuth) {
    return handleUpload(request, tokenAuth.userId);
  }

  return withApiRoute(
    request,
    { requireAuth: true, errorMessage: "Upload failed" },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: "Not authenticated or session expired" },
          { status: 401 },
        );
      if (!sessionHasPermission(session, "storage:write")) {
        throw new ForbiddenError("Insufficient permissions");
      }
      return handleUpload(request, session.userId, session);
    },
  );
}

async function handleUpload(request: Request, userId: string, session?: SessionPayload) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const album = String(formData.get("album") ?? "").trim() || undefined;
    const storageNodeId =
      String(formData.get("storageNodeId") ?? "").trim() || undefined;
    const relativePath =
      String(formData.get("relativePath") ?? "").trim() || undefined;

    if (!isUploadFile(file)) {
      throw new ValidationError("Missing upload file");
    }

    const mimeType = file.type || "application/octet-stream";
    if (!ALLOWED_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) {
      return NextResponse.json(
        { error: "Only image files are supported" },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File size exceeds 20MB limit" },
        { status: 400 },
      );
    }

    const originalName = file.name || "untitled.png";
    const storageKey = generateStorageKey(originalName);
    const checksum = computeChecksum(buffer);

    // Extract image metadata and generate thumbnail using sharp
    let imgWidth: number | null = null;
    let imgHeight: number | null = null;
    try {
      const meta = await extractMetadata(buffer);
      imgWidth = meta.width || null;
      imgHeight = meta.height || null;
    } catch {
      // Not a valid image or sharp can't process — still save as-is
    }

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

    await Promise.all([
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
          if (!mimeType.includes("webp")) {
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
          if (!mimeType.includes("avif")) {
            const avif = await convertToAVIF(buffer);
            await writeFile(avifPath, avif);
            writtenPaths.push(avifPath);
          }
        } catch {
          /* best-effort */
        }
      })(),
    ]);

    let linkedStorageCopyPath: string | null = null;
    let linkedStorageRelativePath: string | null = null;

    // If linked to a storage node, also copy there (cloud storage integration)
    if (storageNodeId && relativePath) {
      if (!session) {
        throw new ForbiddenError("Bearer upload does not support writing to storage node copy");
      }
      const access = await assertStorageAccess({
        session,
        storageNodeId,
        relativePath,
        operation: "write",
        writeBytes: buffer.byteLength,
      });
      if (!access.allowed) {
        throw new ForbiddenError(access.reason ?? "No permission to write to the storage path");
      }
      try {
        const storageNode = await prisma.storageNode.findFirst({
          where: { id: storageNodeId, ...teamWhere(session) },
          select: storageFileNodeSelect,
        });
        if (storageNode && (storageNode.driver === "LOCAL" || storageNode.driver === "SFTP")) {
          linkedStorageRelativePath = `${relativePath.replace(/\/$/, "")}/${storageKey}`;
          const writtenStoragePath = await writeStorageFileBuffer(storageNode, linkedStorageRelativePath, buffer);
          if (storageNode.driver === "LOCAL") linkedStorageCopyPath = writtenStoragePath;
        }
      } catch (e) {
        // Non-fatal: cloud copy is best-effort
        logError("image-bed:cloud-copy-failed", e);
      }
    }

    // Create DB record
    let image;
    try {
      image = await prisma.imageUpload.create({
        data: {
          filename: originalName,
          storageKey,
          mimeType,
          sizeBytes: buffer.byteLength,
          width: imgWidth,
          height: imgHeight,
          checksum,
          album,
          isPublic: true,
          storageNodeId: linkedStorageRelativePath && storageNodeId ? storageNodeId : undefined,
          relativePath: linkedStorageRelativePath || undefined,
          userId: userId,
        },
      });
      if (linkedStorageRelativePath && storageNodeId) {
        await indexLinkedStorageImage({
          storageNodeId,
          relativePath: linkedStorageRelativePath,
          originalName,
          mimeType,
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
        linkedStorageCopyPath
          ? rm(linkedStorageCopyPath, { force: true })
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
    logError("image-bed:upload", error);
    throw new AppError({ code: "INTERNAL_ERROR", message: "Upload failed", status: 500 });
  }
}
