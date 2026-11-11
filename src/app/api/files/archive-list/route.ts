import { apiCopy } from "@/lib/i18n/api-copy";
import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import {
  resolveStoragePathWithinBase,
  sanitizeArchiveEntries,
} from "@/lib/storage/path-utils";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { assertNotRecycled, normalizeIndexedPath } from "@/lib/storage/archive-access";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { archiveListQuerySchema } from "@/lib/files/schema";
import { ArchiveExtractError, archiveKindOf, listArchive } from "@/lib/storage/archive-extract";
import { ExternalArchiveError, listExternalArchive } from "@/lib/storage/archive-external-list";

import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import { getErrorMessage } from "@/lib/http/error-message";
import { archiveErrorCopy, externalArchiveErrorCopy } from "@/lib/storage/archive-error-copy";

export const dynamic = "force-dynamic";

type ArchiveEntry = {
  name: string;
  size: number;
  isDirectory: boolean;
  modified?: string;
};

export async function GET(request: NextRequest) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: apiCopy("apiCopy.failed.to.read.archive.27c0af4a") },
    async ({ session }) => {
      const { nodeId, relativePath: rawRelativePath, name } = parseSearchParams(
        request,
        archiveListQuerySchema,
      );
      // The recycle-bin and access checks compare against indexed (normalized) paths.
      const relativePath = rawRelativePath ? normalizeIndexedPath(rawRelativePath) : rawRelativePath;

      if (!relativePath) {
        throw new ValidationError(apiCopy("apiCopy.missing.file.path.76fdb830"));
      }

      const node = await prisma.storageNode.findFirst({
        where: { id: nodeId, ...teamWhere(session) },
        select: { id: true, name: true, driver: true, basePath: true },
      });
      if (!node) {
        throw new NotFoundError(apiCopy("apiCopy.storage.node.not.found.3b3ec488"));
      }
      if (node.driver !== "LOCAL") {
        return NextResponse.json(
          { error: apiCopy("apiCopy.only.local.storage.node.archive.viewing.is.supported.c4ef9adc") },
          { status: 400 },
        );
      }

      const resolvedPath = resolveStoragePathWithinBase(
        node.basePath,
        relativePath,
      );
      if (!resolvedPath.ok) {
        return NextResponse.json(
          { error: resolvedPath.reason },
          { status: 400 },
        );
      }

      // A deleted archive is still on disk; it must not be listed or unpacked into visible files.
      await assertNotRecycled(node.id, relativePath);

      const accessDecision = await assertStorageAccess({
        session,
        storageNodeId: node.id,
        relativePath,
        operation: "read",
      });
      if (!accessDecision.allowed) {
        return NextResponse.json(
          { error: storageAccessDeniedCopy(accessDecision.reason) },
          { status: 403 },
        );
      }

      const fullPath = resolvedPath.path;
      // Prefer on-disk basename for format detection; client `name` is only a fallback.
      const formatName = path.basename(relativePath) || name;

      try {
        const entries = sanitizeArchiveEntries(
          await listArchiveContents(formatName, fullPath),
        );
        return NextResponse.json({ entries });
      } catch (err) {
        if (err instanceof ArchiveExtractError) {
          throw new ValidationError(archiveErrorCopy(err));
        }
        // No 7z/unrar on the server, an encrypted file list, a damaged file: said in words, not as a server error.
        if (err instanceof ExternalArchiveError) {
          throw new ValidationError(externalArchiveErrorCopy(err));
        }
        const message = getErrorMessage(err, "Failed to read archive");
        throw new AppError({ code: "INTERNAL_ERROR", message: message, status: 500 });
      }
    },
  );
}

async function listArchiveContents(
  name: string,
  fullPath: string,
): Promise<ArchiveEntry[]> {
  const ext = path.extname(name.toLowerCase());

  // ZIP and tar are read in-process: unzip/tar listings vary by build and
  // locale (Ubuntu's unzip dates and GNU tar's escaped Chinese names broke
  // the old parsers), and the Docker image has no unzip at all.
  const kind = archiveKindOf(name);
  if (kind) return listArchive(fullPath, kind);
  if (ext === ".gz") {
    return listGz(fullPath, name);
  }
  if (ext === ".7z") {
    return listExternalArchive("7z", fullPath);
  }
  if (ext === ".rar") {
    return listExternalArchive("rar", fullPath);
  }
  throw new Error(`Unsupported archive format: ${ext}`);
}

async function listGz(
  _filePath: string,
  originalName: string,
): Promise<ArchiveEntry[]> {
  // .gz (non-tar) — just a single compressed file
  const innerName = originalName.replace(/\.gz$/, "");
  return [{ name: innerName, size: 0, isDirectory: false }];
}
