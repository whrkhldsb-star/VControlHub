/**
 * Publish a file from storage node to image bed.
 * POST /api/images/publish-from-storage
 * Body: { storageNodeId, relativePath, filename?, album? }
 */
import * as crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import { resolveStoragePathWithinBase } from "@/lib/storage/path-utils";

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
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: "未登录或会话已过期" },
          { status: 401 },
        );
      const parsed = publishSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success)
        return NextResponse.json({ error: "输入参数无效" }, { status: 400 });
      const { storageNodeId, relativePath, filename, album } = parsed.data;

      // Verify the storage node exists and is accessible
      const storageNode = await prisma.storageNode.findUnique({
        where: { id: storageNodeId },
        select: { id: true, driver: true, basePath: true },
      });
      if (!storageNode || storageNode.driver !== "LOCAL") {
        return NextResponse.json(
          { error: "仅支持本地存储节点" },
          { status: 400 },
        );
      }

      const resolvedSourcePath = resolveStoragePathWithinBase(
        storageNode.basePath,
        relativePath,
      );
      if (!resolvedSourcePath.ok)
        return NextResponse.json(
          { error: resolvedSourcePath.reason },
          { status: 400 },
        );
      const sourcePath = resolvedSourcePath.path;
      const ext = path.extname(relativePath).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext))
        return NextResponse.json(
          { error: "不支持该文件类型" },
          { status: 400 },
        );

      // Read file from storage
      const buffer = await readFile(sourcePath);
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

      // Save to image-bed directory
      await mkdir(UPLOAD_DIR, { recursive: true });
      await writeFile(path.join(UPLOAD_DIR, storageKey), buffer);

      // Create DB record
      const image = await prisma.imageUpload.create({
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
