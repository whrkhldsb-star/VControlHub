import { apiCopy } from "@/lib/i18n/api-copy";

import { NextResponse } from "next/server";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { getServerLocale, t } from "@/lib/i18n/translations";
import type { SessionPayload } from "@/lib/auth/session";
import { lockLiveCustomer, seesAllCustomers } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { IMAGE_UPLOAD_LIMIT } from "@/lib/http/rate-limit-presets";
import { UPLOAD_DIR } from "@/lib/image-bed/constants";
import { logError } from "@/lib/logging";
import { removeOwnedLinkedCopies } from "@/lib/image-bed/linked-copy";
import { deleteImageVariants } from "@/lib/image/service";

import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { auditUserAction } from "@/lib/audit/service";
export const dynamic = "force-dynamic";

function canDeleteImage(input: {
  ownerId: string;
  teamId: string | null;
  session: SessionPayload;
}) {
  const canManageTeamImages =
    seesAllCustomers(input.session) ||
    (input.teamId !== null && input.teamId === input.session.currentTeamId);
  return (
    canManageTeamImages &&
    (input.ownerId === input.session.userId || sessionHasPermission(input.session, "media:manage") ||
      sessionHasPermission(input.session, "team:manage") || sessionHasPermission(input.session, "role:manage"))
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
      errorMessage: apiCopy("apiCopy.delete.failed.8727e2ba"),
    },
    async ({ session }) => {
      const { id } = await params;

      const deleted = await prisma.$transaction(async tx => {
        const image = await tx.imageUpload.findUnique({
          where: { id },
          select: {
            id: true,
            userId: true,
            teamId: true,
            storageKey: true,
            checksum: true,
            sizeBytes: true,
            createdAt: true,
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
          throw new ForbiddenError(apiCopy("apiCopy.no.permission.to.delete.7246baf4"));
        }

        if (image.teamId) await lockLiveCustomer(tx, image.teamId);
        return tx.imageUpload.delete({ where: { id, teamId: image.teamId, userId: image.userId } });
      });

      const [variants, linked] = await Promise.allSettled([
        deleteImageVariants(deleted.storageKey, UPLOAD_DIR),
        removeOwnedLinkedCopies([deleted], session),
      ]);
      const cleanupFailures: string[] = [];
      if (variants.status === "rejected") {
        logError("image-bed:delete-imageBed", variants.reason);
        cleanupFailures.push("imageBed");
      }
      if (linked.status === "rejected" || linked.value.failed.length) {
        if (linked.status === "rejected") logError("image-bed:delete-linkedStorage", linked.reason);
        cleanupFailures.push("linkedStorage");
      }
      const teamId = deleted.teamId;

      await auditUserAction(
        session.userId,
        "image.delete",
        { imageId: id, cleanupFailures },
        cleanupFailures.length > 0 ? "WARNING" : undefined,
        teamId,
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
