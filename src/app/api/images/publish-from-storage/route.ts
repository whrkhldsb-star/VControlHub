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
import {
  IMAGE_EXTENSIONS,
  mimeTypeFromExt,
  UPLOAD_DIR,
} from "@/lib/image-bed/constants";
import { logError } from "@/lib/logging";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { readStorageFileBuffer, storageFileNodeSelect } from "@/lib/storage/file-content";

import { ForbiddenError } from "@/lib/errors";
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
      errorMessage: "Failed to publish from storage",
      bodySchema: publishSchema,
    },
    async ({ session, body }) => {
      if (!session)
        return NextResponse.json(
          { error: "Not authenticated or session expired" },
          { status: 401 },
        );
      const { storageNodeId, relativePath, filename, album } = body;

      // Verify the storage node exists, is in team scope, and is a supported driver.
      const storageNode = await prisma.storageNode.findFirst({
        where: { id: storageNodeId, ...teamWhere(session) },
        select: storageFileNodeSelect,
      });
      if (!storageNode) {
        return NextResponse.json(
          { error: "Storage node not found" },
          { status: 404 },
        );
      }
      if (storageNode.driver !== "LOCAL" && storageNode.driver !== "SFTP") {
        return NextResponse.json(
          { error: "Only LOCAL or SFTP storage nodes are supported" },
          { status: 400 },
        );
      }

      const ext = path.extname(relativePath).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext))
        return NextResponse.json(
          { error: "Unsupported file type" },
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
          message: "File already exists (checksum matched), skipping upload",
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
            teamId: session.currentTeamId ?? null,
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
