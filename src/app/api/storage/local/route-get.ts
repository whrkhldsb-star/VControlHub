import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";

import { NextResponse } from "next/server";

import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { getErrorMessage } from "@/lib/http/error-message";
import { guessContentType } from "@/lib/http/mime-types";
import type { Locale } from "@/lib/i18n/translations";
import { t } from "@/lib/i18n/translations";
import { logError } from "@/lib/logging";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { resolveManagedLocalEntryPath } from "@/lib/storage/fs-backend";
import { normalizeStorageRelativePath } from "@/lib/storage/path-utils";
import { contentDownloadQuerySchema } from "@/lib/storage/schema";
import { parseStorageRange, storageStreamResponse } from "@/lib/storage/streaming";
import { parseSearchParams } from "@/lib/http/parse-search-params";

export async function handleLocalStorageGet(
  request: Request,
  session: SessionPayload,
  locale: Locale,
) {
  const { path: relativePath, nodeId: storageNodeId, download } = parseSearchParams(
    request,
    contentDownloadQuerySchema,
  );
  if (!relativePath) throw new ValidationError(t("api.storage.missingPath", locale));
  if (!storageNodeId) throw new ValidationError(t("api.storage.missingNodeId", locale));
  const normalizedDownloadPath = normalizeStorageRelativePath(relativePath);
  if (!normalizedDownloadPath.ok) {
    return NextResponse.json({ error: normalizedDownloadPath.reason }, { status: 400 });
  }
  const entry = await prisma.fileEntry.findFirst({
    where: {
      relativePath: normalizedDownloadPath.path,
      isDeleted: false,
      storageNodeId,
      storageNode: { driver: "LOCAL", ...teamWhere(session) },
    },
    include: {
      storageNode: {
        select: { id: true, name: true, basePath: true, driver: true, teamId: true },
      },
    },
  });
  if (!entry) {
    return NextResponse.json({ error: t("api.storage.localEntryNotFound", locale) }, { status: 404 });
  }
  const accessDecision = await assertStorageAccess({
    session,
    storageNodeId: entry.storageNode.id,
    relativePath: entry.relativePath,
    operation: "read",
  });
  if (!accessDecision.allowed) {
    return NextResponse.json(
      { error: accessDecision.reason ?? t("api.storage.accessDenied", locale) },
      { status: 403 },
    );
  }
  let absolutePath: string;
  try {
    ({ absolutePath } = await resolveManagedLocalEntryPath({
      basePath: entry.storageNode.basePath,
      relativePath: normalizedDownloadPath.path,
    }));
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, t("api.storage.invalidPath", locale)) },
      { status: 400 },
    );
  }
  try {
    await access(absolutePath);
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      return NextResponse.json(
        { error: t("api.storage.notDownloadableFile", locale) },
        { status: 400 },
      );
    }
    const range = parseStorageRange(request.headers.get("range"), fileStat.size);
    if (range instanceof Response) return range;
    const streamOptions = range.status === 206 ? { start: range.start, end: range.end } : undefined;
    return storageStreamResponse({
      stream: createReadStream(absolutePath, streamOptions),
      range,
      fileName: entry.name,
      fileSize: fileStat.size,
      contentType: guessContentType(entry.name, entry.mimeType),
      download,
    });
  } catch (downloadError) {
    logError("[/api/storage/local] download error:", downloadError);
    return NextResponse.json({ error: t("api.storage.fileUnavailable", locale) }, { status: 404 });
  }
}
