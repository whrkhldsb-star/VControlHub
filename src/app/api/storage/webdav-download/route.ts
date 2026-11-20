import { apiCopy } from "@/lib/i18n/api-copy";
import path from "node:path";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { guessContentType } from "@/lib/http/mime-types";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { assertNotRecycled } from "@/lib/storage/archive-access";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { contentDownloadQuerySchema } from "@/lib/storage/schema";
import { getStorageFileNode } from "@/lib/storage/file-content";
import { normalizeStorageRelativePath } from "@/lib/storage/path-utils";
import { createRemoteStorageClient } from "@/lib/storage/agent-file-client";
import { parseStorageRange, buildStorageStreamHeaders } from "@/lib/storage/streaming";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "storage:read", errorMessage: apiCopy("apiCopy.webdav.download.failed.06b49c4b") }, async ({ session }) => {
    const query = parseSearchParams(request, contentDownloadQuerySchema);
    if (!query.nodeId || !query.path) throw new ValidationError(apiCopy("apiCopy.nodeid.and.path.are.required.873193de"));
    const normalized = normalizeStorageRelativePath(query.path);
    if (!normalized.ok) throw new ValidationError(normalized.reason);
    const node = await getStorageFileNode(query.nodeId, session);
    if (!node || (node.driver !== "WEBDAV" && node.driver !== "AGENT")) throw new NotFoundError(apiCopy("apiCopy.webdav.node.not.found.ac1b2fce"));
    const access = await assertStorageAccess({ session, storageNodeId: node.id, relativePath: normalized.path, operation: "read" });
    if (!access.allowed) throw new ForbiddenError(storageAccessDeniedCopy(access.reason));
    await assertNotRecycled(node.id, normalized.path);
    const client = createRemoteStorageClient(node);
    const entry = await client.stat(normalized.path);
    if (!entry || entry.isDirectory) throw new NotFoundError(apiCopy("apiCopy.file.unavailable.b3b9efed"));
    const range = parseStorageRange(request.headers.get("range"), entry.size);
    if (range instanceof Response) return range;
    // The client validates the upstream GET against this same metadata, including the range total.
    const body = await client.stream(normalized.path, range.status === 206 ? range : undefined, entry.size, entry.etag);
    const headers = buildStorageStreamHeaders({ range, fileName: path.posix.basename(normalized.path), fileSize: entry.size, contentType: guessContentType(normalized.path), download: query.download });
    return new Response(body, { status: range.status, headers });
  });
}
