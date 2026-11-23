import { matchTargetMode } from "@/lib/storage/local-permissions";
import { assertCanonicalWritePath, assertNotRecycled } from "@/lib/storage/archive-access";
import { randomBytes } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";


import { NextResponse } from "next/server";

import type { SessionPayload } from "@/lib/auth/session";

import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { assertStorageAccess, releaseStorageQuotaGuard } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { logError } from "@/lib/logging";
import { managedSftpWriteRoot, statBackingObject } from "@/lib/storage/fs-backend";
import { lockStorageFileOverwrite } from "@/lib/storage/file-overwrite-lock";
import { validateStorageFileIndex } from "@/lib/storage/schema";
import { previousFileIndexFields, writeFileIndex } from "@/lib/storage/file-write-index";
import { snapshotFileVersionBeforeOverwrite } from "@/lib/storage/file-versions";
import { resolveManagedLocalPath } from "@/lib/storage/managed-path";
import { isCaseInsensitiveStorageNode, normalizeStorageRelativePath } from "@/lib/storage/path-utils";
import {
  createRemoteDirectory,
  writeRemoteFile,
} from "@/lib/ssh/client";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import { normalizeRemoteTargetPath } from "@/lib/storage/remote-path";
import { assertRemotePathContained } from "@/lib/storage/remote-containment";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { withApiRoute } from "@/lib/http/api-guard";
import { getStorageUploadMaxBytes } from "@/lib/upload/limits";
import { rejectOversizedFormBody } from "@/lib/http/form-body-limit";
import { PROXY_CLIENT_MAX_BODY_BYTES } from "@/lib/http/proxy-body-limit";
import { requestContentLengthExceeds } from "@/lib/http/request-body";

import { ConflictError, ValidationError } from "@/lib/errors";
import { getErrorMessage } from "@/lib/http/error-message";
import { t as serviceTranslate } from "@/lib/i18n/service-translations";
import { getServerLocale, t, type Locale } from "@/lib/i18n/translations";
import { handleLocalStorageGet } from "./route-get";
import { writeStorageFileBuffer } from "@/lib/storage/file-content";
import { SSH_KEY_CREDENTIAL_SELECT } from "@/lib/ssh/ssh-key-crypto";

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
const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

async function handlePost(request: Request, session: SessionPayload, locale: Locale) {
  // formData() buffers the whole body before the per-file size checks below,
  // so refuse an oversized / length-undeclared (chunked) body up front.
  // The same runtime limit as chunked uploads (A4-26); the old 100 MiB constant
  // refused files the settings page said were allowed.
  const maxUploadBytes = getStorageUploadMaxBytes();
  // This route reads its whole body into memory, behind the proxy, which
  // passes on no more than PROXY_CLIENT_MAX_BODY_BYTES of it. A larger body
  // arrived cut short and failed as "Failed to parse body as FormData"; the
  // chunked upload (/api/storage/upload/init) takes files up to the storage
  // limit and is what the file manager uses from 5 MiB.
  if (requestContentLengthExceeds(request, PROXY_CLIENT_MAX_BODY_BYTES)) {
    return NextResponse.json(
      {
        error: t("api.storage.singleRequestUploadTooLarge", locale, {
          max: Math.floor((PROXY_CLIENT_MAX_BODY_BYTES - MAX_MULTIPART_OVERHEAD_BYTES) / (1024 * 1024)),
        }),
        maxUploadBytes: Math.min(maxUploadBytes, PROXY_CLIENT_MAX_BODY_BYTES - MAX_MULTIPART_OVERHEAD_BYTES),
      },
      { status: 413 },
    );
  }
  const rejected = rejectOversizedFormBody(
    request,
    maxUploadBytes + MAX_MULTIPART_OVERHEAD_BYTES,
    {
      tooLargeMessage: t("api.storage.uploadTooLarge", locale),
      fields: { maxUploadBytes: maxUploadBytes },
    },
  );
  if (rejected) return rejected;
  const formData = await request.formData();
  const storageNodeId = String(formData.get("storageNodeId") ?? "").trim();
  const relativePath = String(formData.get("relativePath") ?? "");
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
  if (declaredFileSize !== null && declaredFileSize > maxUploadBytes) {
    return NextResponse.json(
      {
        error: t("api.storage.uploadTooLarge", locale),
        maxUploadBytes: maxUploadBytes,
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
      webdavConfigEncrypted: true,
      host: true,
      port: true,
      username: true,
      teamId: true,
      hostKeySha256: true,
      server: {
        select: {
          id: true,
          teamId: true,
          host: true,
          port: true,
          username: true,
          connectionType: true,
          managementMode: true,
          operatingSystem: true,
          password: true,
          hostKeySha256: true,
          sshKey: { select: SSH_KEY_CREDENTIAL_SELECT },
        },
      },
    },
  });

  if (!storageNode || !["LOCAL", "SFTP", "WEBDAV", "AGENT"].includes(storageNode.driver)) {
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
    } else if (storageNode.driver === "WEBDAV" || storageNode.driver === "AGENT") {
      normalizedRelativePath = normalizedUploadPath.path;
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
  if (fileBuffer.byteLength > maxUploadBytes) {
    return NextResponse.json(
      {
        error: t("api.storage.uploadTooLarge", locale),
        maxUploadBytes: maxUploadBytes,
        size: fileBuffer.byteLength,
      },
      { status: 413 },
    );
  }
  // Always charge quota against the real body length — never trust client-declared size.
  const byteSize = fileBuffer.byteLength;
  const accessDecision = await assertStorageAccess({
    session,
    storageNodeId,
    relativePath: normalizedRelativePath,
    operation: "write",
    writeBytes: byteSize,
  });
  if (!accessDecision.allowed) {
    return NextResponse.json(
      { error: storageAccessDeniedCopy(accessDecision.reason, locale) },
      { status: 403 },
    );
  }
  let releaseOverwrite: (() => Promise<void>) | undefined;
  try {
  releaseOverwrite = await lockStorageFileOverwrite(storageNodeId, normalizedRelativePath);
  const index = validateStorageFileIndex({
    storageNodeId, relativePath: normalizedRelativePath, mimeType: file.type, size: byteSize,
  });
  const caseInsensitive = isCaseInsensitiveStorageNode(storageNode);
  const existingEntryForVersion = await prisma.fileEntry.findFirst({
    where: {
      storageNodeId,
      relativePath: caseInsensitive
        ? { equals: normalizedRelativePath, mode: "insensitive" as const }
        : normalizedRelativePath,
    },
    select: previousFileIndexFields,
  });
  // A folder (or one in the recycle bin) of that name is in the way: writing would turn its row into a file's
  // and the move into place fail on the real folder.
  if (existingEntryForVersion?.entryType === "DIRECTORY") {
    return NextResponse.json({ error: t("api.storage.targetIsDirectory", locale) }, { status: 409 });
  }
  if (existingEntryForVersion?.isDeleted) throw new ConflictError(serviceTranslate("backend.webdav.destinationHeldByRecycleBin", { path: `/${normalizedRelativePath}` }));
  await assertNotRecycled(storageNodeId, normalizedRelativePath, "write", storageNode.driver, caseInsensitive);
  await assertCanonicalWritePath(storageNodeId, normalizedRelativePath, storageNode.driver, caseInsensitive);
  if (existingEntryForVersion) {
    await snapshotFileVersionBeforeOverwrite({
      fileEntryId: existingEntryForVersion.id,
      userId: session.userId,
      reason: "UPLOAD",
      note: "Before single-shot upload overwrite",
    });
  }

  // Resolve remote containment and check for a collection before recording the new metadata.
  let sftpCredentials: ReturnType<typeof resolveStorageSshCredentials> | undefined;
  if (storageNode.driver === "SFTP" && remotePath) {
    try {
      sftpCredentials = resolveStorageSshCredentials(storageNode);
    } catch (error) {
      return NextResponse.json(
        { error: getErrorMessage(error, t("api.storage.connectionCredentialsUnavailable", locale)) },
        { status: 400 },
      );
    }
    try {
      remotePath = await assertRemotePathContained(sftpCredentials, storageNode.basePath, remotePath);
    } catch (error) {
      if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
  }
  const backing = await statBackingObject({ storageNode, relativePath: normalizedRelativePath });
  if (backing?.isDirectory) {
    return NextResponse.json({ error: t("api.storage.targetIsDirectory", locale) }, { status: 409 });
  }

  let stagedLocalPath: string | undefined;
  try {
    if (absolutePath) {
      const parent = path.dirname(absolutePath);
      await mkdir(parent, { recursive: true });
      stagedLocalPath = path.join(parent, `.vch-upload-${randomBytes(6).toString("hex")}.tmp`);
      await writeFile(stagedLocalPath, fileBuffer, { flag: "wx", mode: 0o600 });
      await matchTargetMode(stagedLocalPath, absolutePath);
    }

    let rollback: Awaited<ReturnType<typeof writeFileIndex>>;
    try {
      rollback = await writeFileIndex(index, existingEntryForVersion);
    } catch (error) {
      if (error instanceof ConflictError) throw error;
      if ((error as NodeJS.ErrnoException)?.code === "P2025") {
        throw new ConflictError(serviceTranslate("backend.storage.editableFileUpdatedByOther"));
      }
      logError("[/api/storage/local] upload index error:", error);
      return NextResponse.json(
        { error: t("api.storage.writeIndexFailed", locale, { message: getErrorMessage(error, "Unknown error") }) },
        { status: 500 },
      );
    }
    try {
      if (absolutePath && stagedLocalPath) {
        await rename(stagedLocalPath, absolutePath);
        stagedLocalPath = undefined;
      } else if (remotePath && sftpCredentials) {
        await createRemoteDirectory({ ...sftpCredentials, remotePath: path.posix.dirname(remotePath), recursive: true });
        const checked = await assertRemotePathContained(sftpCredentials, storageNode.basePath, normalizeRemoteTargetPath(storageNode.basePath, normalizedRelativePath));
        if (checked !== remotePath) throw new ConflictError(serviceTranslate("backend.storage.editableFileChangedOnDisk"));
        await writeRemoteFile({ ...sftpCredentials, remotePath, content: fileBuffer,
          root: managedSftpWriteRoot(remotePath, normalizedRelativePath, sftpCredentials.windowsOpenSsh) });
      } else {
        await writeStorageFileBuffer(storageNode, normalizedRelativePath, fileBuffer);
      }
    } catch (error) {
      await rollback();
      if (storageNode.driver === "SFTP") {
        logError("[/api/storage/local] sftp upload error:", error);
        return NextResponse.json(
          { error: getErrorMessage(error, t("api.storage.remoteUploadFailed", locale)) },
          { status: 502 },
        );
      }
      throw error;
    }
  } finally {
    if (stagedLocalPath) await unlink(stagedLocalPath).catch(() => undefined);
  }

  return NextResponse.json({
    ok: true,
    storageNodeId,
    relativePath: normalizedRelativePath,
    size: byteSize,
  });
  } finally {
    await releaseOverwrite?.();
    await releaseStorageQuotaGuard(accessDecision);
  }
}

export async function GET(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: t("api.storage.fileUnavailable", locale) },
    async ({ session }) => {
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
      return handlePost(request, session, locale);
    },
  );
}
