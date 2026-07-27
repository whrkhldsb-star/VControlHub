import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";


import { NextResponse } from "next/server";

import type { SessionPayload } from "@/lib/auth/session";

import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { assertStorageAccess, releaseStorageQuotaGuard } from "@/lib/storage/access-control";
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
import { MAX_STORAGE_UPLOAD_BYTES } from "@/lib/storage/mime-constants";

import { AuthError, ValidationError } from "@/lib/errors";
import { isUniqueViolation } from "@/lib/db";
import { getErrorMessage } from "@/lib/http/error-message";
import { getServerLocale, t, type Locale } from "@/lib/i18n/translations";
import { handleLocalStorageGet } from "./route-get";

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

async function handlePost(request: Request, session: SessionPayload, locale: Locale) {
  const formData = await request.formData();
  const storageNodeId = String(formData.get("storageNodeId") ?? "").trim();
  const relativePath = String(formData.get("relativePath") ?? "").trim();
  const file = formData.get("file");

  if (!storageNodeId) {
    return NextResponse.json(
      { error: t("api.storage.missingStorageNodeId", locale) },
      { status: 400 },
    );
  }

  if (!relativePath) {
    return NextResponse.json(
      { error: t("api.storage.missingRelativePath", locale) },
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
    throw new ValidationError(t("api.storage.missingUploadFile", locale));
  }

  const declaredFileSize =
    typeof file.size === "number" && Number.isFinite(file.size) && file.size >= 0
      ? file.size
      : null;
  if (declaredFileSize !== null && declaredFileSize > MAX_STORAGE_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: t("api.storage.uploadTooLarge", locale),
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
      hostKeySha256: true,
      server: {
        select: {
          host: true,
          port: true,
          username: true,
          connectionType: true,
          password: true,
          hostKeySha256: true,
          sshKey: { select: { privateKey: true } },
        },
      },
    },
  });

  if (!storageNode || !["LOCAL", "SFTP"].includes(storageNode.driver)) {
    return NextResponse.json(
      { error: t("api.storage.unsupportedUploadNode", locale) },
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
      { error: getErrorMessage(error, t("api.storage.invalidPath", locale)) },
      { status: 400 },
    );
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  if (fileBuffer.byteLength > MAX_STORAGE_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: t("api.storage.uploadTooLarge", locale),
        maxUploadBytes: MAX_STORAGE_UPLOAD_BYTES,
        size: fileBuffer.byteLength,
      },
      { status: 413 },
    );
  }
  // Always charge quota against the real body length — never trust client-declared size.
  const byteSize = fileBuffer.byteLength;
  if (declaredFileSize !== null && declaredFileSize !== byteSize) {
    // Soft consistency: ignore mismatch for quota; actual bytes win.
  }
  const accessDecision = await assertStorageAccess({
    session,
    storageNodeId,
    relativePath: normalizedRelativePath,
    operation: "write",
    writeBytes: byteSize,
  });
  if (!accessDecision.allowed) {
    return NextResponse.json(
      { error: accessDecision.reason ?? t("api.storage.writeDenied", locale) },
      { status: 403 },
    );
  }
  try {
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
        { error: t("api.storage.resolveLocalPathFailed", locale) },
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
        { error: t("api.storage.resolveRemotePathFailed", locale) },
        { status: 400 },
      );
    }
    try {
      sftpCredentials = resolveStorageSshCredentials(storageNode);
    } catch (error) {
      return NextResponse.json(
        { error: getErrorMessage(error, t("api.storage.connectionCredentialsUnavailable", locale)) },
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
        { error: getErrorMessage(error, t("api.storage.remoteUploadFailed", locale)) },
        { status: 502 },
      );
    }
  }

  const indexData = {
    name: fileName,
    entryType: "FILE" as const,
    mimeType,
    size: BigInt(byteSize),
    isDeleted: false as const,
  };

  try {
    const existingEntry = existingEntryForVersion;

    if (existingEntry) {
      await prisma.fileEntry.update({
        where: { id: existingEntry.id },
        data: indexData,
      });
    } else {
      try {
        await prisma.fileEntry.create({
          data: {
            storageNodeId,
            relativePath: normalizedRelativePath,
            ...indexData,
          },
        });
      } catch (createError) {
        // Concurrent first-time uploads both write the blob; the loser must
        // update the winner's index and MUST NOT unlink the shared path.
        if (!isUniqueViolation(createError)) throw createError;
        const raced = await prisma.fileEntry.findFirst({
          where: {
            storageNodeId,
            relativePath: normalizedRelativePath,
          },
          select: { id: true },
        });
        if (!raced) throw createError;
        await prisma.fileEntry.update({
          where: { id: raced.id },
          data: indexData,
        });
      }
    }
  } catch (error) {
    logError("[/api/storage/local] upload index error:", error);
    // Never cleanup on unique-constraint races — the competing request owns
    // a valid FileEntry that still points at this blob path.
    if (!isUniqueViolation(error)) {
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
    }
    const message = getErrorMessage(error, "Unknown error");
    return NextResponse.json(
      { error: t("api.storage.writeIndexFailed", locale, { message }) },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    storageNodeId,
    relativePath: normalizedRelativePath,
    size: byteSize,
  });
  } finally {
    await releaseStorageQuotaGuard(accessDecision);
  }
}

export async function GET(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: t("api.storage.fileUnavailable", locale) },
    async ({ session }) => {
      if (!session)
        throw new AuthError(t("api.auth.sessionExpired", locale));
      return handleLocalStorageGet(request, session, locale);
    },
  );
}

export async function POST(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: t("api.image.uploadFailed", locale),
    },
    async ({ session }) => {
      if (!session)
        throw new AuthError(t("api.auth.sessionExpired", locale));
      return handlePost(request, session, locale);
    },
  );
}
