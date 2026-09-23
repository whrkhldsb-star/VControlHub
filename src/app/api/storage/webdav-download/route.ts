import { apiCopy } from "@/lib/i18n/api-copy";
import path from "node:path";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { guessContentType } from "@/lib/http/mime-types";
import { AuthError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { contentDownloadQuerySchema } from "@/lib/storage/schema";
import { getStorageFileNode, streamStorageFile } from "@/lib/storage/file-content";
import { normalizeStorageRelativePath } from "@/lib/storage/path-utils";
import { createWebDavClient } from "@/lib/storage/webdav-client";
import { parseStorageRange, storageStreamResponse } from "@/lib/storage/streaming";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "storage:read", errorMessage: apiCopy("apiCopy.webdav.download.failed.06b49c4b") }, async ({ session }) => {
    if (!session) throw new AuthError(apiCopy("apiCopy.unauthorized.d089c8a9"));
    const query = parseSearchParams(request, contentDownloadQuerySchema);
    if (!query.nodeId || !query.path) throw new ValidationError(apiCopy("apiCopy.nodeid.and.path.are.required.873193de"));
    const normalized = normalizeStorageRelativePath(query.path);
    if (!normalized.ok) throw new ValidationError(normalized.reason);
    const node = await getStorageFileNode(query.nodeId, session);
    if (!node || node.driver !== "WEBDAV") throw new NotFoundError(apiCopy("apiCopy.webdav.node.not.found.ac1b2fce"));
    const access = await assertStorageAccess({ session, storageNodeId: node.id, relativePath: normalized.path, operation: "read" });
    if (!access.allowed) throw new ForbiddenError(storageAccessDeniedCopy(access.reason));
    const indexed = await prisma.fileEntry.findFirst({ where: { storageNodeId: node.id, relativePath: normalized.path }, select: { isDeleted: true } });
    if (indexed?.isDeleted) throw new NotFoundError(apiCopy("apiCopy.file.unavailable.b3b9efed"));
    const entry = await createWebDavClient(node).stat(normalized.path);
    if (!entry || entry.isDirectory) throw new NotFoundError(apiCopy("apiCopy.file.unavailable.b3b9efed"));
    const range = parseStorageRange(request.headers.get("range"), entry.size);
    if (range instanceof Response) return range;
    const result = await streamStorageFile(node, normalized.path, range.status === 206 ? range : undefined);
    const stream: NodeJS.ReadableStream = result.stream;
    stream.once("close", result.close);
    stream.once("error", result.close);
    return storageStreamResponse({ stream: result.stream, range, fileName: path.posix.basename(normalized.path), fileSize: entry.size, contentType: guessContentType(normalized.path), download: query.download });
  });
}
