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

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { IMAGE_UPLOAD_LIMIT } from "@/lib/http/rate-limit-presets";
import {
  IMAGE_EXTENSIONS,
  mimeTypeFromExt,
  UPLOAD_DIR,
} from "@/lib/image-bed/constants";
import { logError } from "@/lib/logging";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { readStorageFileBuffer, storageFileNodeSelect } from "@/lib/storage/file-content";

import { ForbiddenError, ValidationError } from "@/lib/errors";
const publishSchema = z.object({
  storageNodeId: z.string().min(1),
  relativePath: z.string().min(1),
  filename: z.string().optional(),
  album: z.string().optional(),
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "storage:read",
      rateLimit: IMAGE_UPLOAD_LIMIT,
      errorMessage: "从云盘发布失败",
      bodySchema: publishSchema,
    },
    async ({ session, body }) => {
      if (!session)
        return NextResponse.json(
          { error: "未登录或会话已过期" },
          { status: 401 },
        );
      const { storageNodeId, relativePath, filename, album } = body;

      // Verify the storage node exists and is accessible
      const storageNode = await prisma.storageNode.findUnique({
        where: { id: storageNodeId },
        select: storageFileNodeSelect,
      });
      if (!storageNode || (storageNode.driver !== "LOCAL" && storageNode.driver !== "SFTP")) {
        return NextResponse.json(
          { error: "仅支持本地或 SFTP 存储节点" },
          { status: 400 },
        );
      }

      const ext = path.extname(relativePath).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext))
        return NextResponse.json(
          { error: "不支持该文件类型" },
          { status: 400 },
        );

      const readAccess = await assertStorageAccess({
        session,
        storageNodeId,
        relativePath,
        operation: "read",
      });
      if (!readAccess.allowed) {
        throw new ForbiddenError(readAccess.reason);
      }

      // Read file from storage after the exact storage path has been authorized.
      const buffer = await readStorageFileBuffer(storageNode, relativePath);
      const originalName = filename || path.basename(relativePath);
      const storageKey = `${crypto.randomUUID()}${ext}`;
      const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

      // Check for duplicate
      const existing = await prisma.imageUpload.findFirst({
        where: { checksum },
      });
      if (existing) {
        return NextResponse.json({
          image: existing,
          publicUrl: `/api/images/${existing.id}/file`,
          message: "文件已存在（checksum 匹配），跳过上传",
        });
      }

      // Save to image-bed directory before creating the index row. If the DB
      // write fails, compensate by deleting the just-written served file so the
      // API cannot return upload failure while leaving an orphan public object.
      await mkdir(UPLOAD_DIR, { recursive: true });
      const imagePath = path.join(UPLOAD_DIR, storageKey);
      await writeFile(imagePath, buffer);

      // Create DB record
      let image;
      try {
        image = await prisma.imageUpload.create({
          data: {
            filename: originalName,
            storageKey,
            mimeType: mimeTypeFromExt(ext),
            sizeBytes: buffer.byteLength,
            checksum,
            album: album?.trim() || undefined,
            isPublic: true,
            storageNodeId,
            relativePath,
            userId: session.userId,
          },
        });
      } catch (error) {
        await rm(imagePath, { force: true }).catch((cleanupError) => {
          logError("image-bed:publish-from-storage-cleanup", cleanupError);
        });
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
