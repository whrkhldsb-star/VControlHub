import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import { getMediaItem } from "@/lib/media/service";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { normalizeStorageRelativePath } from "@/lib/storage/path-utils";
import { toClientStorageError } from "@/lib/storage/remote-path";
import { respondWithStorageThumbnail } from "@/lib/storage/thumbnail-response";
import { getServerLocale } from "@/lib/i18n/translations";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";

import { apiError } from "@/lib/http/api-error";
export const dynamic = "force-dynamic";

const SUPPORTED_IMAGE_MIME_PREFIX = "image/";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "storage:read",
      rateLimit: GENERAL_READ_LIMIT,
      errorMessage: apiCopy("apiCopy.failed.to.read.media.thumbnail.5158317a"),
    },
    async ({ session }) => {
      const locale = await getServerLocale();
      const { id } = await params;
      const item = await getMediaItem(id, session, {
        includeCredentials: true,
      });
      if (!item || !item.storageNode)
        return apiError({
          code: "NOT_FOUND",
          message: apiCopy("apiCopy.media.not.found.287cb4d8"),
          status: 404,
        });

      const mime = (item.mimeType ?? "").toLowerCase();
      if (!mime.startsWith(SUPPORTED_IMAGE_MIME_PREFIX)) {
        // Tell the client we don't have a thumbnail; the UI then falls back to the
        // generic kind icon (and avoids hammering /stream for big videos).
        return apiError({
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: apiCopy("apiCopy.this.media.type.does.not.support.thumbnails.885a4cf2"),
          status: 415,
        });
      }

      // Normalize once and authorize once — on the NORMALIZED path. The
      // previous flow ran the ACL on the raw stored path and a second time
      // inside the SFTP branch after normalization, doubling every
      // node/grant lookup per request.
      const normalizedRelative = normalizeStorageRelativePath(item.relativePath);
      if (!normalizedRelative.ok) {
        return NextResponse.json(
          toClientStorageError(
            apiCopy("apiCopy.requested.path.exceeds.storage.node.root.directory.d786fee2"),
          ),
          { status: 400 },
        );
      }
      const accessDecision = await assertStorageAccess({
        session,
        storageNodeId: item.storageNode.id,
        relativePath: normalizedRelative.path,
        operation: "read",
      });
      if (!accessDecision.allowed) {
        return apiError({
          code: "FORBIDDEN",
          message: storageAccessDeniedCopy(accessDecision.reason, locale),
          status: 403,
        });
      }

      return respondWithStorageThumbnail({
        id: item.id,
        updatedAt: item.updatedAt ?? null,
        relativePath: normalizedRelative.path,
        node: item.storageNode,
      });
    },
  );
}
