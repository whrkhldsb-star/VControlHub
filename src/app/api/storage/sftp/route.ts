import { assertNotRecycled } from "@/lib/storage/archive-access";
import { prisma } from "@/lib/db";
import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";
import type { SessionPayload } from "@/lib/auth/session";

import { assertStorageAccess } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { isStorageStagingPath } from "@/lib/storage/staging-paths";
import { listRemoteDirectory } from "@/lib/ssh/client";
import { getSftpNodeConnection } from "@/lib/storage/sftp-node";
import { assertRemotePathContained } from "@/lib/storage/remote-containment";
import {
  normalizeRemotePath,
  normalizeRemoteRelativePath,
  toClientStorageError,
} from "@/lib/storage/remote-path";
import { createLogger } from "@/lib/logging";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { sftpListQuerySchema } from "@/lib/storage/schema";

import { ValidationError } from "@/lib/errors";
const logger = createLogger("api:storage:sftp");

export const dynamic = "force-dynamic";

async function handleGet(request: Request, session: SessionPayload) {
  const { nodeId, path: remotePath, limit } = parseSearchParams(
    request,
    sftpListQuerySchema,
  );
  if (!nodeId) {
    throw new ValidationError(apiCopy("apiCopy.missing.nodeid.parameter.6d98c74c"));
  }

  const { node, credentials: connectionCredentials } = await getSftpNodeConnection(nodeId, session);

  const normalizedRelativePath = normalizeRemoteRelativePath(remotePath);
  let normalizedRemotePath = normalizeRemotePath(node.basePath, normalizedRelativePath);

  const accessDecision = await assertStorageAccess({
    session,
    storageNodeId: node.id,
    relativePath: normalizedRelativePath,
    operation: "read",
  });
  if (!accessDecision.allowed) {
    return NextResponse.json(
      { error: storageAccessDeniedCopy(accessDecision.reason) },
      { status: 403 },
    );
  }
  await assertNotRecycled(node.id, normalizedRelativePath, "read", node.driver, connectionCredentials.windowsOpenSsh);
  // Same place physically: no symlink hop below the node root.
  try {
    normalizedRemotePath = await assertRemotePathContained(connectionCredentials, node.basePath, normalizedRemotePath);
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(toClientStorageError(error.message), { status: 400 });
    }
    throw error;
  }

  try {
    const pathKey = (value: string) => connectionCredentials.windowsOpenSsh ? value.toLowerCase() : value;
    const entries = await listRemoteDirectory({
      ...connectionCredentials,
      remotePath: normalizedRemotePath,
      maxEntries: limit + 1,
    });
    const childPath = (name: string) => [normalizedRelativePath, name].filter(Boolean).join("/");
    const deleted = await prisma.fileEntry.findMany({
      where: { storageNodeId: node.id, isDeleted: true, relativePath: { in: entries.map(entry => childPath(entry.name)), ...(connectionCredentials.windowsOpenSsh && { mode: "insensitive" as const }) } },
      select: { relativePath: true },
    });
    const hidden = new Set(deleted.map(entry => pathKey(entry.relativePath)));
    const truncated = entries.length > limit;
    return NextResponse.json({
      nodeId: node.id,
      nodeName: node.name,
      remotePath: remotePath.startsWith("/") ? remotePath : `/${remotePath}`,
      entries: entries.slice(0, limit).filter(entry => !isStorageStagingPath(pathKey(entry.name)) && !hidden.has(pathKey(childPath(entry.name)))),
      truncated,
      limit,
    });
  } catch (error) {
    logger.error("list remote directory failed", error);
    return NextResponse.json(
      toClientStorageError("Connection to remote node failed, please check node configuration or remote path"),
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: apiCopy("apiCopy.failed.to.list.remote.directory.4ccd5b6f") },
    async ({ session }) => {
      return handleGet(request, session);
    },
  );
}
