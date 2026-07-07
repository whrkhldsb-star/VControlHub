import { NextResponse } from "next/server";
import type { SessionPayload } from "@/lib/auth/session";

import { prisma } from "@/lib/db";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { listRemoteDirectory } from "@/lib/ssh/client";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import {
  normalizeRemotePath,
  normalizeRemoteRelativePath,
  toClientStorageError,
} from "@/lib/storage/remote-path";
import { createLogger } from "@/lib/logging";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { sftpListQuerySchema } from "@/lib/storage/schema";

import { AuthError, NotFoundError, ValidationError } from "@/lib/errors";
const logger = createLogger("api:storage:sftp");

export const dynamic = "force-dynamic";

async function handleGet(request: Request, session: SessionPayload) {
  const _url = new URL(request.url);
  const { nodeId, path: remotePath } = parseSearchParams(
    request,
    sftpListQuerySchema,
  );
  void nodeId; // currently unused beyond existence; preserved for parity with the prior ad-hoc parser.

  if (!nodeId) {
    throw new ValidationError("Missing nodeId Parameter");
  }

  const node = await prisma.storageNode.findUnique({
    where: { id: nodeId },
    select: {
      id: true,
      name: true,
      driver: true,
      basePath: true,
      host: true,
      port: true,
      username: true,
      serverId: true,
      server: {
        select: {
          id: true,
          host: true,
          port: true,
          username: true,
          connectionType: true,
          password: true,
          sshKey: {
            select: {
              privateKey: true,
            },
          },
        },
      },
    },
  });

  if (!node) {
    throw new NotFoundError("Storage node not found");
  }

  if (node.driver !== "SFTP") {
    return NextResponse.json(
      { error: "This Node is Not SFTP type" },
      { status: 400 },
    );
  }

  const connectionCredentials = (() => {
    try {
      return resolveStorageSshCredentials(node);
    } catch (error) {
      return error instanceof Error
        ? error
        : new Error("Missing remote host address or connection credentials, cannot connect");
    }
  })();
  if (connectionCredentials instanceof Error) {
    return NextResponse.json(
      { error: connectionCredentials.message },
      { status: 400 },
    );
  }

  let normalizedRemotePath: string;
  let normalizedRelativePath: string;
  try {
    normalizedRemotePath = normalizeRemotePath(node.basePath, remotePath);
    normalizedRelativePath = normalizeRemoteRelativePath(remotePath);
  } catch {
    return NextResponse.json(
      toClientStorageError("Requested path exceeds storage node root directory"),
      { status: 400 },
    );
  }

  const accessDecision = await assertStorageAccess({
    session,
    storageNodeId: node.id,
    relativePath: normalizedRelativePath,
    operation: "read",
  });
  if (!accessDecision.allowed) {
    return NextResponse.json(
      { error: accessDecision.reason ?? "Missing storage access authorization" },
      { status: 403 },
    );
  }

  try {
    const entries = await listRemoteDirectory({
      host: connectionCredentials.host,
      port: connectionCredentials.port,
      username: connectionCredentials.username,
      privateKey: connectionCredentials.privateKey,
      password: connectionCredentials.password,
      remotePath: normalizedRemotePath,
    });
    return NextResponse.json({
      nodeId: node.id,
      nodeName: node.name,
      remotePath: remotePath.startsWith("/") ? remotePath : `/${remotePath}`,
      entries,
    });
  } catch (error) {
    logger.error("list remote directory failed", error);
    return NextResponse.json(
      toClientStorageError("connectionremoteNodeFailed，pleaseCheckNodeconfiguredorremotepath"),
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: "Failed to list remote directory" },
    async ({ session }) => {
      if (!session)
        throw new AuthError("Not authenticated");
      return handleGet(request, session);
    },
  );
}
