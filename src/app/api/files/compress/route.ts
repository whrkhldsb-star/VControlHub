import { apiCopy } from "@/lib/i18n/api-copy";
import { localTarForceLocalArgs, resolveLocalTarBinary } from "@/lib/runtime/tar-binary";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { publishLocalFile } from "@/lib/storage/publish-local-file";
import { lockStorageFileOverwrite } from "@/lib/storage/file-overwrite-lock";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";

import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { compressFilesBodySchema } from "@/lib/files/schema";
import { assertStorageAccess, releaseStorageQuotaGuard } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { createFileEntry } from "@/lib/storage/service";
import { normalizeIndexedPath, recycledAround } from "@/lib/storage/archive-access";
import { localTarExclusion } from "@/lib/storage/archive-stream";
import { expandStorageBasePath, resolveStoragePathWithinBase } from "@/lib/storage/path-utils";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: apiCopy("apiCopy.compression.failed.0dc061b7"),
      bodySchema: compressFilesBodySchema,
    },
    async ({ session, body }) => {
      const { storageNodeId, relativePaths, targetDir } = body;
      const outputName = normalizeArchiveName(body.outputName);
      const targetRelativeDir = normalizeDir(targetDir ?? path.posix.dirname(relativePaths[0] ?? ""));
      const outputRelativePath = path.posix.join(targetRelativeDir, outputName);

      const node = await prisma.storageNode.findFirst({
        where: { id: storageNodeId, ...teamWhere(session) },
        select: { id: true, driver: true, basePath: true },
      });
      if (!node) throw new NotFoundError(apiCopy("apiCopy.storage.node.not.found.3b3ec488"));
      if (node.driver !== "LOCAL") {
        return NextResponse.json({ error: apiCopy("apiCopy.only.local.storage.node.batch.compression.is.supported.e0ba1ea9") }, { status: 400 });
      }

      const writeDecision = await assertStorageAccess({
        session,
        storageNodeId: node.id,
        relativePath: targetRelativeDir,
        operation: "write",
      });
      if (!writeDecision.allowed) {
        return NextResponse.json({ error: storageAccessDeniedCopy(writeDecision.reason) }, { status: 403 });
      }

      const outputResolved = resolveStoragePathWithinBase(node.basePath, outputRelativePath);
      if (!outputResolved.ok) return NextResponse.json({ error: outputResolved.reason }, { status: 400 });

      const indexedOutput = () => prisma.fileEntry.findFirst({
        where: { storageNodeId: node.id, relativePath: outputRelativePath },
        select: { id: true },
      });
      const conflict = () => NextResponse.json({ error: apiCopy("apiCopy.target.archive.already.exists.18a7a63f", { v0: String(outputRelativePath) }) }, { status: 409 });
      if (await indexedOutput() || await pathExists(outputResolved.path)) return conflict();

      const inputs: string[] = [];
      const excluded: string[] = [];
      for (const rawRelativePath of relativePaths) {
        // Normalized as the index stores it, so the recycle-bin check and the tar member list name the same paths.
        const relativePath = normalizeIndexedPath(rawRelativePath);
        if (!relativePath) return NextResponse.json({ error: apiCopy("apiCopy.files.op.invalid") }, { status: 400 });
        if (relativePath === outputRelativePath) {
          return NextResponse.json({ error: apiCopy("apiCopy.cannot.include.the.target.archive.in.itself.42093cb4") }, { status: 400 });
        }
        const readDecision = await assertStorageAccess({
          session,
          storageNodeId: node.id,
          relativePath,
          operation: "read",
        });
        if (!readDecision.allowed) {
          return NextResponse.json({ error: storageAccessDeniedCopy(readDecision.reason) }, { status: 403 });
        }
        const resolved = resolveStoragePathWithinBase(node.basePath, relativePath);
        if (!resolved.ok) return NextResponse.json({ error: resolved.reason }, { status: 400 });
        if (!await pathExists(resolved.path)) throw new NotFoundError(apiCopy("apiCopy.file.not.found.c7066170", { v0: String(relativePath) }));
        // Deleting only marks the index; the bytes are still on disk. An archive made from the folder would
        // bring deleted files back as new, visible, shareable ones.
        const recycled = await recycledAround(node.id, relativePath);
        if (recycled.onPath) throw new NotFoundError(apiCopy("apiCopy.file.not.found.c7066170", { v0: String(relativePath) }));
        excluded.push(...recycled.below);
        inputs.push(relativePath);
      }

      await fs.mkdir(path.dirname(outputResolved.path), { recursive: true });
      const stage = await fs.mkdtemp(path.join(path.dirname(outputResolved.path), ".vch-compress-"));
      const archive = path.join(stage, "archive");
      const base = path.resolve(expandStorageBasePath(node.basePath));
      try {
        const listPath = path.join(stage, "files.txt");
        await fs.writeFile(listPath, inputs.join("\0") + "\0");
        excluded.push(path.relative(base, stage).split(path.sep).join("/"));
        const exclusion = localTarExclusion(excluded, path.join(stage, "exclude.txt"));
        if (exclusion.fileContent !== null) await fs.writeFile(path.join(stage, "exclude.txt"), exclusion.fileContent);
        await execFileAsync(resolveLocalTarBinary(), ["-czf", archive, "-C", base, ...localTarForceLocalArgs(), ...exclusion.options, "--null", "-T", listPath], {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 600_000,
        });
        const { size } = await fs.stat(archive);
        const admission = await assertStorageAccess({ session, storageNodeId: node.id, relativePath: outputRelativePath, operation: "write", writeBytes: size });
        try {
          if (!admission.allowed) return NextResponse.json({ error: storageAccessDeniedCopy(admission.reason) }, { status: 403 });
          const release = await lockStorageFileOverwrite(node.id, outputRelativePath);
          try {
            if (await indexedOutput()) return conflict();
            await publishLocalFile(archive, outputResolved.path, outputRelativePath);
            // If indexing fails, preserve the published bytes for reconciliation.
            await createFileEntry({ storageNodeId: node.id, name: outputName, entryType: "FILE", mimeType: "application/gzip", size, relativePath: outputRelativePath });
          } finally {
            await release();
          }
        } finally {
          await releaseStorageQuotaGuard(admission);
        }
        return NextResponse.json({
          message: apiCopy("apiCopy.created.archive.0d5ec1fd", { v0: outputRelativePath }),
          relativePath: outputRelativePath, name: outputName, size,
        });
      } finally {
        for (const name of ["archive", "files.txt", "exclude.txt"]) await fs.rm(path.join(stage, name), { force: true });
        await fs.rmdir(stage);
      }
    },
  );
}

function normalizeArchiveName(name: string) {
  return name.toLowerCase().endsWith(".tar.gz") ? name : `${name}.tar.gz`;
}

function normalizeDir(dir: string) {
  const normalized = dir.replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized === "." ? "" : normalized;
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
