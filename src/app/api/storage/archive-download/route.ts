import { openManagedArchive } from "@/lib/storage/archive-access";
import { apiCopy } from "@/lib/i18n/api-copy";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { stat } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";
import type { Client } from "ssh2";

import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { createLogger } from "@/lib/logging";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import {
  archiveStreamResponse,
  closeSshClientOnStreamEnd,
  connectArchiveSsh,
  safeArchiveName,
  streamLocalTarGz,
  streamRemoteTarGz,
} from "@/lib/storage/archive-stream";
import { normalizeStorageRelativePath, resolveStoragePathWithinBase } from "@/lib/storage/path-utils";
import { normalizeRemoteTargetPath, toClientStorageError } from "@/lib/storage/remote-path";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import { storageFileQuerySchema } from "@/lib/storage/schema";
import { isDirectoryEntry } from "@/lib/files/tree";

import { AuthError, NotFoundError, ValidationError } from "@/lib/errors";
export const dynamic = "force-dynamic";

const logger = createLogger("api:storage:archive-download");

type DirectoryEntry = {
  id: string;
  name: string;
  relativePath: string;
  entryType: string;
  mimeType: string | null;
  storageNode: {
    id: string;
    name: string;
    driver: string;
    basePath: string;
    host: string | null;
    port: number | null;
    username: string | null;
    hostKeySha256: string | null;
    server: {
      id: string;
      host: string;
      port: number;
      username: string;
      connectionType: string;
      managementMode: string;
      password: string | null;
      hostKeySha256: string | null;
      sshKey: { privateKey: string } | null;
    } | null;
  };
};

async function findDirectoryEntry(
  nodeId: string,
  relativePath: string,
  session: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
) {
  return prisma.fileEntry.findFirst({
    where: {
      storageNodeId: nodeId,
      relativePath,
      isDeleted: false,
      storageNode: {
        ...teamWhere(session),
      },
    },
    include: {
      storageNode: {
        select: {
          id: true,
          name: true,
          driver: true,
          basePath: true,
          host: true,
          port: true,
          username: true,
          hostKeySha256: true,
          server: {
            select: {
              id: true,
              host: true,
              port: true,
              username: true,
              connectionType: true,
              managementMode: true,
              password: true,
              hostKeySha256: true,
              sshKey: { select: { privateKey: true } },
            },
          },
        },
      },
    },
  }) as Promise<DirectoryEntry | null>;
}

export async function GET(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(request, { permission: "storage:read" }, async ({ session }) => {
    if (!session) {
      throw new AuthError(apiCopy("apiCopy.not.authenticated.76d1efbe"));
    }

    const { nodeId, path: requestedPath } = parseSearchParams(
      request,
      storageFileQuerySchema,
    );

    if (!nodeId) {
      throw new ValidationError(apiCopy("apiCopy.missing.nodeid.parameter.6d98c74c"));
    }
    if (!requestedPath) {
      throw new ValidationError(apiCopy("apiCopy.missing.path.parameter.352f3af2"));
    }

    const normalizedPath = normalizeStorageRelativePath(requestedPath);
    if (!normalizedPath.ok) {
      throw new ValidationError(normalizedPath.reason);
    }

    const entry = await findDirectoryEntry(nodeId, normalizedPath.path, session);
    if (!entry) {
      throw new NotFoundError(apiCopy("apiCopy.directory.entry.not.found.ddf8c64a"));
    }
    if (!isDirectoryEntry(entry)) {
      throw new ValidationError(apiCopy("apiCopy.target.is.not.a.directory.b74f7510"));
    }

    const accessDecision = await assertStorageAccess({
      session,
      storageNodeId: entry.storageNode.id,
      relativePath: entry.relativePath,
      operation: "read",
    });
    if (!accessDecision.allowed) {
      return NextResponse.json(
        { error: storageAccessDeniedCopy(accessDecision.reason, locale) },
        { status: 403 },
      );
    }

    const archiveName = safeArchiveName(entry.name);

    if (entry.storageNode.driver === "LOCAL") {
      const resolved = resolveStoragePathWithinBase(entry.storageNode.basePath, entry.relativePath);
      if (!resolved.ok) {
        throw new ValidationError(resolved.reason);
      }
      const directoryStat = await stat(resolved.path).catch(() => null);
      if (!directoryStat?.isDirectory()) {
        throw new NotFoundError(apiCopy("apiCopy.local.directory.not.found.or.cannot.be.read.fddf033b"));
      }
      const stream = await openManagedArchive({
        storageNodeId: entry.storageNode.id, relativePath: entry.relativePath, signal: request.signal,
        open: (excluded) => streamLocalTarGz(resolved.path, path.basename(resolved.path), excluded),
      });
      return archiveStreamResponse(stream, archiveName);
    }

    if (entry.storageNode.driver !== "SFTP") {
      throw new ValidationError(apiCopy("apiCopy.this.storage.node.does.not.support.directory.download.9454c3ca"));
    }

    // Never echo resolveStorageSshCredentials' internal failure text to the
    // client (it can embed host/credential details); answer with the stable
    // translated copy instead. The previous code also leaked whatever the
    // resolver threw wrapped in a 400 ValidationError.
    let credentials: Awaited<ReturnType<typeof resolveStorageSshCredentials>>;
    try {
      credentials = resolveStorageSshCredentials(entry.storageNode);
    } catch {
      throw new ValidationError(
        t("backend.storageHardening.storage.missingConnectionCredentials", locale),
      );
    }
    if (credentials.agentServerId && !credentials.privateKey && !credentials.password) {
      throw new ValidationError(
        apiCopy("apiCopy.pure.agent.nodes.require.target.direct.access.or.an.ssh.fallback.3c9ade65"),
      );
    }

    let client: Client | null = null;
    try {
      const remotePath = normalizeRemoteTargetPath(entry.storageNode.basePath, entry.relativePath);
      client = await connectArchiveSsh({
        host: credentials.host,
        port: credentials.port,
        username: credentials.username,
        hostKeySha256: credentials.hostKeySha256,
        agentServerId: credentials.agentServerId,
        privateKey: credentials.privateKey,
        password: credentials.password,
        readyTimeout: 15000,
        timeout: 10000,
      });
      const archiveClient = client;
      const stream = await openManagedArchive({
        storageNodeId: entry.storageNode.id, relativePath: entry.relativePath, signal: request.signal,
        open: (excluded) => streamRemoteTarGz(archiveClient, remotePath, excluded),
      });
      closeSshClientOnStreamEnd(stream, client);
      client = null;
      return archiveStreamResponse(stream, archiveName);
    } catch (error) {
      client?.end();
      logger.error("archive download failed", error, { nodeId: entry.storageNode.id });
      return NextResponse.json(toClientStorageError("Directory archive download failed"), { status: 502 });
    }
  });
}
