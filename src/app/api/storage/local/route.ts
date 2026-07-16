import { createReadStream } from "node:fs";
import { access, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { guessContentType } from "@/lib/http/mime-types";

import { NextResponse } from "next/server";

import type { SessionPayload } from "@/lib/auth/session";

import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { logError } from "@/lib/logging";
import { snapshotFileVersionBeforeOverwrite } from "@/lib/storage/file-versions";
import {
  expandStorageBasePath,
  normalizeStorageRelativePath,
} from "@/lib/storage/path-utils";
import {
  createRemoteDirectory,
  deleteRemoteFile,
  writeRemoteFile,
} from "@/lib/ssh/client";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import { normalizeRemoteTargetPath } from "@/lib/storage/remote-path";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { contentDownloadQuerySchema } from "@/lib/storage/schema";
import { MAX_STORAGE_UPLOAD_BYTES } from "@/lib/storage/mime-constants";
import { parseStorageRange, storageStreamResponse } from "@/lib/storage/streaming";

import { AuthError, ValidationError } from "@/lib/errors";
type UploadLike = {
  arrayBuffer(): Promise<ArrayBuffer>;
  name?: string;
  type?: string;
  size?: number;
};

function isUploadLike(value: unknown): value is UploadLike {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as UploadLike).arrayBuffer === "function"
  );
}

export const dynamic = "force-dynamic";

function resolveManagedLocalPath(basePath: string, relativePath: string) {
  const normalizedPath = normalizeStorageRelativePath(relativePath);
  if (!normalizedPath.ok) {
    throw new Error(normalizedPath.reason);
  }

  const normalizedRelativePath = normalizedPath.path;
  const allowedRoot = path.resolve(expandStorageBasePath(basePath));
  const absolutePath = path.resolve(allowedRoot, normalizedRelativePath);
  const relativeToRoot = path.relative(allowedRoot, absolutePath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new ValidationError("Invalid path");
  }

  return {
    normalizedRelativePath,
    absolutePath,
    allowedRoot,
  };
}

async function handleGet(request: Request, session: SessionPayload) {
  const { path: relativePath, nodeId: storageNodeId, download } = parseSearchParams(
    request,
    contentDownloadQuerySchema,
  );

  if (!relativePath) {
    throw new ValidationError("Missing path parameter");
  }

  const normalizedDownloadPath = normalizeStorageRelativePath(relativePath);
  if (!normalizedDownloadPath.ok) {
    return NextResponse.json(
      { error: normalizedDownloadPath.reason },
      { status: 400 },
    );
  }

  const entryWhere: Record<string, unknown> = {
    relativePath: normalizedDownloadPath.path,
    isDeleted: false,
    storageNode: {
      driver: "LOCAL",
    },
  };
  // If nodeId specified, scope to that specific node to avoid cross-node path collisions
  if (storageNodeId) {
    entryWhere.storageNodeId = storageNodeId;
  }

  const entry = await prisma.fileEntry.findFirst({
    where: entryWhere,
    include: {
      storageNode: {
        select: {
          id: true,
          name: true,
          basePath: true,
          driver: true,
        },
      },
    },
  });

  if (!entry) {
    return NextResponse.json(
      { error: "file entry not found, or not registered as local storage file" },
      { status: 404 },
    );
  }

  const accessDecision = await assertStorageAccess({
    session,
    storageNodeId: entry.storageNode.id,
    relativePath: entry.relativePath,
    operation: "read",
  });
  if (!accessDecision.allowed) {
    return NextResponse.json(
      { error: accessDecision.reason ?? "Missing storage access authorization" },
      { status: 403 },
    );
  }

  let absolutePath: string;
  try {
    ({ absolutePath } = resolveManagedLocalPath(
      entry.storageNode.basePath,
      normalizedDownloadPath.path,
    ));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid path" },
      { status: 400 },
    );
  }

  try {
    await access(absolutePath);
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      return NextResponse.json(
        { error: "TargetnotiscanDownloadFile" },
        { status: 400 },
      );
    }

    const range = parseStorageRange(request.headers.get("range"), fileStat.size);
    if (range instanceof Response) return range;
    const streamOptions = range.status === 206 ? { start: range.start, end: range.end } : undefined;
    const nodeStream = createReadStream(absolutePath, streamOptions);
    return storageStreamResponse({
      stream: nodeStream,
      range,
      fileName: entry.name,
      fileSize: fileStat.size,
      contentType: guessContentType(entry.name, entry.mimeType),
      download,
    });
  } catch (downloadError) {
    logError("[/api/storage/local] download error:", downloadError);
    return NextResponse.json(
      { error: "File not found or temporarily cannot be read" },
      { status: 404 },
    );
  }
}

async function handlePost(request: Request, session: SessionPayload) {
  const formData = await request.formData();
  const storageNodeId = String(formData.get("storageNodeId") ?? "").trim();
  const relativePath = String(formData.get("relativePath") ?? "").trim();
  const file = formData.get("file");

  if (!storageNodeId) {
    return NextResponse.json(
      { error: "Missing storageNodeId Parameter" },
      { status: 400 },
    );
  }

  if (!relativePath) {
    return NextResponse.json(
      { error: "Missing relativePath Parameter" },
      { status: 400 },
    );
  }

  const normalizedUploadPath = normalizeStorageRelativePath(relativePath);
  if (!normalizedUploadPath.ok) {
    return NextResponse.json(
      { error: normalizedUploadPath.reason },
      { status: 400 },
    );
  }

  if (!isUploadLike(file)) {
    throw new ValidationError("Missing upload file");
  }

  const declaredFileSize =
    typeof file.size === "number" && Number.isFinite(file.size) && file.size >= 0
      ? file.size
      : null;
  if (declaredFileSize !== null && declaredFileSize > MAX_STORAGE_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: "upload file exceeds 100 MB, please use download task or SFTP tool for large files",
        maxUploadBytes: MAX_STORAGE_UPLOAD_BYTES,
        size: declaredFileSize,
      },
      { status: 413 },
    );
  }

  const storageNode = await prisma.storageNode.findFirst({
    where: { id: storageNodeId, ...teamWhere(session) },
    select: {
      id: true,
      name: true,
      driver: true,
      basePath: true,
      host: true,
      port: true,
      username: true,
      server: {
        select: {
          host: true,
          port: true,
          username: true,
          connectionType: true,
          password: true,
          sshKey: { select: { privateKey: true } },
        },
      },
    },
  });

  if (!storageNode || !["LOCAL", "SFTP"].includes(storageNode.driver)) {
    return NextResponse.json(
      { error: "Only supports uploading to LOCAL or SFTP storage nodes" },
      { status: 400 },
    );
  }

  let normalizedRelativePath: string;
  let absolutePath: string | null = null;
  let remotePath: string | null = null;

  try {
    if (storageNode.driver === "LOCAL") {
      ({ normalizedRelativePath, absolutePath } = resolveManagedLocalPath(
        storageNode.basePath,
        normalizedUploadPath.path,
      ));
    } else {
      normalizedRelativePath = normalizedUploadPath.path;
      remotePath = normalizeRemoteTargetPath(
        storageNode.basePath,
        normalizedRelativePath,
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid path" },
      { status: 400 },
    );
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  if (fileBuffer.byteLength > MAX_STORAGE_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: "upload file exceeds 100 MB, please use download task or SFTP tool for large files",
        maxUploadBytes: MAX_STORAGE_UPLOAD_BYTES,
        size: fileBuffer.byteLength,
      },
      { status: 413 },
    );
  }
  const byteSize =
    declaredFileSize !== null ? declaredFileSize : fileBuffer.byteLength;
  const accessDecision = await assertStorageAccess({
    session,
    storageNodeId,
    relativePath: normalizedRelativePath,
    operation: "write",
    writeBytes: byteSize,
  });
  if (!accessDecision.allowed) {
    return NextResponse.json(
      { error: accessDecision.reason ?? "Missing storage write authorization" },
      { status: 403 },
    );
  }
  const mimeType = file.type || null;
  const fileName = path.posix.basename(normalizedRelativePath);

  let uploadedLocalPath: string | null = null;
  let uploadedRemotePath: string | null = null;
  let sftpCredentials: ReturnType<typeof resolveStorageSshCredentials> | null =
    null;

  // Look up existing index early so we can snapshot before overwrite.
  const existingEntryForVersion = await prisma.fileEntry.findFirst({
    where: {
      storageNodeId,
      relativePath: normalizedRelativePath,
    },
    select: { id: true },
  });
  if (existingEntryForVersion) {
    await snapshotFileVersionBeforeOverwrite({
      fileEntryId: existingEntryForVersion.id,
      userId: session.userId,
      reason: "UPLOAD",
      note: "Before single-shot upload overwrite",
    });
  }

    if (storageNode.driver === "LOCAL") {
    if (!absolutePath) {
      return NextResponse.json(
        { error: "failed to resolve local storage path" },
        { status: 400 },
      );
    }
    const parentDir = path.dirname(absolutePath);
    await mkdir(parentDir, { recursive: true });
    await writeFile(absolutePath, fileBuffer);
    uploadedLocalPath = absolutePath;
  } else {
    if (!remotePath) {
      return NextResponse.json(
        { error: "failed to resolve remote storage path" },
        { status: 400 },
      );
    }
    try {
      sftpCredentials = resolveStorageSshCredentials(storageNode);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "connectioncredentialsCannotavailable" },
        { status: 400 },
      );
    }
    const remoteParent = path.posix.dirname(remotePath);
    try {
      await createRemoteDirectory({
        ...sftpCredentials,
        remotePath: remoteParent,
        recursive: true,
      });
      await writeRemoteFile({
        ...sftpCredentials,
        remotePath,
        content: fileBuffer,
      });
      uploadedRemotePath = remotePath;
    } catch (error) {
      logError("[/api/storage/local] sftp upload error:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Remote upload failed" },
        { status: 502 },
      );
    }
  }

  try {
    const existingEntry = existingEntryForVersion;

    if (existingEntry) {
      await prisma.fileEntry.update({
        where: { id: existingEntry.id },
        data: {
          name: fileName,
          entryType: "FILE",
          mimeType,
          size: BigInt(byteSize),
          isDeleted: false,
        },
      });
    } else {
      await prisma.fileEntry.create({
        data: {
          storageNodeId,
          name: fileName,
          entryType: "FILE",
          mimeType,
          size: BigInt(byteSize),
          relativePath: normalizedRelativePath,
        },
      });
    }
  } catch (error) {
    logError("[/api/storage/local] upload index error:", error);
    if (uploadedLocalPath) {
      try {
        await unlink(uploadedLocalPath);
      } catch (cleanupError) {
        logError(
          "[/api/storage/local] local upload cleanup error:",
          cleanupError,
        );
      }
    }
    if (uploadedRemotePath && sftpCredentials) {
      try {
        await deleteRemoteFile({
          ...sftpCredentials,
          remotePath: uploadedRemotePath,
        });
      } catch (cleanupError) {
        logError(
          "[/api/storage/local] sftp upload cleanup error:",
          cleanupError,
        );
      }
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to write upload index: ${message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    storageNodeId,
    relativePath: normalizedRelativePath,
    size: byteSize,
  });
}

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: "Failed to read local file" },
    async ({ session }) => {
      if (!session)
        throw new AuthError("Not authenticated");
      return handleGet(request, session);
    },
  );
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "Failed to upload file",
    },
    async ({ session }) => {
      if (!session)
        throw new AuthError("Not authenticated");
      return handlePost(request, session);
    },
  );
}
