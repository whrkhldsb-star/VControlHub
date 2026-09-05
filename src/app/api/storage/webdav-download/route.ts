import path from "node:path";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { guessContentType } from "@/lib/http/mime-types";
import { AuthError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { contentDownloadQuerySchema } from "@/lib/storage/schema";
import { getStorageFileNode, streamStorageFile } from "@/lib/storage/file-content";
import { normalizeStorageRelativePath } from "@/lib/storage/path-utils";
import { createWebDavClient } from "@/lib/storage/webdav-client";
import { parseStorageRange, storageStreamResponse } from "@/lib/storage/streaming";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "storage:read", errorMessage: "WebDAV download failed" }, async ({ session }) => {
    if (!session) throw new AuthError("Unauthorized");
    const query = parseSearchParams(request, contentDownloadQuerySchema);
    if (!query.nodeId || !query.path) throw new ValidationError("nodeId and path are required");
    const normalized = normalizeStorageRelativePath(query.path);
    if (!normalized.ok) throw new ValidationError(normalized.reason);
    const node = await getStorageFileNode(query.nodeId, session);
    if (!node || node.driver !== "WEBDAV") throw new NotFoundError("WebDAV node not found");
    const access = await assertStorageAccess({ session, storageNodeId: node.id, relativePath: normalized.path, operation: "read" });
    if (!access.allowed) throw new ForbiddenError(access.reason ?? "Storage access denied");
    const indexed = await prisma.fileEntry.findFirst({ where: { storageNodeId: node.id, relativePath: normalized.path }, select: { isDeleted: true } });
    if (indexed?.isDeleted) throw new NotFoundError("File unavailable");
    const entry = await createWebDavClient(node).stat(normalized.path);
    if (!entry || entry.isDirectory) throw new NotFoundError("File unavailable");
    const range = parseStorageRange(request.headers.get("range"), entry.size);
    if (range instanceof Response) return range;
    const result = await streamStorageFile(node, normalized.path, range.status === 206 ? range : undefined);
    const stream: NodeJS.ReadableStream = result.stream;
    stream.once("close", result.close);
    stream.once("error", result.close);
    return storageStreamResponse({ stream: result.stream, range, fileName: path.posix.basename(normalized.path), fileSize: entry.size, contentType: guessContentType(normalized.path), download: query.download });
  });
}
