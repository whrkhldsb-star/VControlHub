import { unlink } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { getServerLocale, t } from "@/lib/i18n/translations";
import type { SessionPayload } from "@/lib/auth/session";
import { isGlobalTeamManager, teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { IMAGE_UPLOAD_LIMIT } from "@/lib/http/rate-limit-presets";
import { UPLOAD_DIR } from "@/lib/image-bed/constants";
import { logError } from "@/lib/logging";
import { resolveStoragePathWithinBase } from "@/lib/storage/path-utils";
import { deleteImageVariants } from "@/lib/image/service";

import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { auditUserAction } from "@/lib/audit/service";
export const dynamic = "force-dynamic";

function isNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function unlinkIfPresent(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
}

function canDeleteImage(input: {
  ownerId: string;
  teamId: string | null;
  session: SessionPayload;
}) {
  const canManageTeamImages =
    isGlobalTeamManager(input.session) ||
    (input.teamId !== null && input.teamId === input.session.currentTeamId);
  return (
    input.ownerId === input.session.userId ||
    (canManageTeamImages &&
      (sessionHasPermission(input.session, "media:manage") ||
        sessionHasPermission(input.session, "team:manage") ||
        sessionHasPermission(input.session, "role:manage")))
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "image:write",
      rateLimit: IMAGE_UPLOAD_LIMIT,
      errorMessage: "Delete failed",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: "Not authenticated or session expired" },
          { status: 401 },
        );
      const { id } = await params;

      const image = await prisma.imageUpload.findUnique({
        where: { id },
        select: {
          id: true,
          userId: true,
          teamId: true,
          storageKey: true,
          storageNodeId: true,
          relativePath: true,
        },
      });

      if (!image)
        throw new NotFoundError(
          t("api.imageNotFound", await getServerLocale()),
        );

      // Only owner or explicit destructive/admin permissions can delete.
      // `user:read` is intentionally not enough because viewer accounts have it.
      if (
        !canDeleteImage({
          ownerId: image.userId,
          teamId: image.teamId,
          session,
        })
      ) {
        throw new ForbiddenError("No permission to delete");
      }

      // Resolve physical cleanup targets before revoking the database record.
      // Cross-team node ids are ignored for physical delete + index cascade.
      let linkedStorageInTeam = false;
      let linkedFilePath: string | null = null;
      if (image.storageNodeId && image.relativePath) {
        const storageNode = await prisma.storageNode.findFirst({
          where: { id: image.storageNodeId, ...teamWhere(session) },
          select: { basePath: true, driver: true },
        });
        if (storageNode) {
          linkedStorageInTeam = true;
          if (storageNode.driver === "LOCAL") {
            const resolvedDir = resolveStoragePathWithinBase(
              storageNode.basePath,
              image.relativePath,
            );
            if (!resolvedDir.ok) {
              return NextResponse.json(
                { error: resolvedDir.reason },
                { status: 400 },
              );
            }
            // New records store the full relative file path; legacy records
            // stored only the directory. Support both shapes during cleanup.
            linkedFilePath =
              path.basename(image.relativePath) === image.storageKey
                ? resolvedDir.path
                : path.join(resolvedDir.path, image.storageKey);
          }
        }
      }

      const ownsLinkedStorageCopy = Boolean(
        linkedStorageInTeam &&
        image.storageNodeId &&
        image.relativePath &&
        path.basename(image.relativePath) === image.storageKey,
      );
      if (ownsLinkedStorageCopy) {
        await prisma.$transaction([
          prisma.mediaItem.deleteMany({
            where: {
              storageNodeId: image.storageNodeId!,
              relativePath: image.relativePath!,
            },
          }),
          prisma.fileEntry.deleteMany({
            where: {
              storageNodeId: image.storageNodeId!,
              relativePath: image.relativePath!,
            },
          }),
          prisma.imageUpload.delete({ where: { id } }),
        ]);
      } else {
        await prisma.imageUpload.delete({ where: { id } });
      }

      // Database deletion revokes API access atomically. Physical cleanup is
      // best-effort afterwards; failures are surfaced without leaving a live
      // database row pointing at partially deleted files.
      const cleanupTasks = [
        {
          target: "imageBed",
          promise: deleteImageVariants(image.storageKey, UPLOAD_DIR),
        },
        ...(linkedFilePath
          ? [{ target: "linkedStorage", promise: unlinkIfPresent(linkedFilePath) }]
          : []),
      ];
      const cleanupResults = await Promise.allSettled(
        cleanupTasks.map((task) => task.promise),
      );
      const cleanupFailures = cleanupResults.flatMap((result, index) => {
        if (result.status === "fulfilled") return [];
        logError(`image-bed:delete-${cleanupTasks[index]?.target}`, result.reason);
        return [cleanupTasks[index]?.target ?? "unknown"];
      });

      await auditUserAction(
        session?.userId ?? "",
        "image.delete",
        { imageId: id, cleanupFailures },
        cleanupFailures.length > 0 ? "WARNING" : undefined,
        session?.currentTeamId,
      );
      if (cleanupFailures.length > 0) {
        return NextResponse.json(
          {
            success: false,
            deleted: true,
            cleanupPending: true,
            cleanupFailures,
          },
          { status: 207 },
        );
      }
      return NextResponse.json({ success: true });
    },
  );
}
