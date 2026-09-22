import { apiCopy } from "@/lib/i18n/api-copy";
import { resolveLocalTarBinary } from "@/lib/runtime/tar-binary";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";

import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { AuthError, NotFoundError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { compressFilesBodySchema } from "@/lib/files/schema";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { createFileEntry } from "@/lib/storage/service";
import { resolveStoragePathWithinBase } from "@/lib/storage/path-utils";
import { getErrorMessage } from "@/lib/http/error-message";

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
      if (!session) throw new AuthError(apiCopy("apiCopy.unauthorized.d089c8a9"));

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
        return NextResponse.json({ error: writeDecision.reason ?? "No write permission for target directory" }, { status: 403 });
      }

      const outputResolved = resolveStoragePathWithinBase(node.basePath, outputRelativePath);
      if (!outputResolved.ok) return NextResponse.json({ error: outputResolved.reason }, { status: 400 });

      const existingOutput = await prisma.fileEntry.findFirst({
        where: { storageNodeId: node.id, relativePath: outputRelativePath, isDeleted: false },
        select: { id: true },
      });
      if (existingOutput || await pathExists(outputResolved.path)) {
        return NextResponse.json({ error: apiCopy("apiCopy.target.archive.already.exists.18a7a63f", { v0: String(outputRelativePath) }) }, { status: 409 });
      }

      const inputs: string[] = [];
      for (const rawRelativePath of relativePaths) {
        const relativePath = rawRelativePath.replace(/^\/+/, "");
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
          return NextResponse.json({ error: readDecision.reason ?? `No read permission for /${relativePath}` }, { status: 403 });
        }
        const resolved = resolveStoragePathWithinBase(node.basePath, relativePath);
        if (!resolved.ok) return NextResponse.json({ error: resolved.reason }, { status: 400 });
        if (!await pathExists(resolved.path)) throw new NotFoundError(apiCopy("apiCopy.file.not.found.c7066170", { v0: String(relativePath) }));
        inputs.push(relativePath);
      }

      await fs.mkdir(path.dirname(outputResolved.path), { recursive: true });
      const { listPath, tempDir } = await writeTarList(inputs);
      try {
        await execFileAsync(resolveLocalTarBinary(), ["-czf", outputResolved.path, "-C", node.basePath, "--null", "-T", listPath], {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 120_000,
        });
      } catch (error) {
        await fs.rm(outputResolved.path, { force: true });
        const message = getErrorMessage(error, "tar command failed");
        return NextResponse.json({ error: apiCopy("apiCopy.compression.failed.ce90f433", { v0: String(message) }) }, { status: 500 });
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }

      const outputStat = await fs.stat(outputResolved.path);
      try {
        await createFileEntry({
          storageNodeId: node.id,
          name: outputName,
          entryType: "FILE",
          mimeType: "application/gzip",
          size: outputStat.size,
          relativePath: outputRelativePath,
        });
      } catch (error) {
        await fs.rm(outputResolved.path, { force: true });
        throw error;
      }

      return NextResponse.json({
        message: apiCopy("apiCopy.created.archive.0d5ec1fd", { v0: String(outputRelativePath) }),
        relativePath: outputRelativePath,
        name: outputName,
        size: outputStat.size,
      });
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

async function writeTarList(relativePaths: string[]) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vch-compress-"));
  const listPath = path.join(tempDir, "files.txt");
  await fs.writeFile(listPath, relativePaths.join("\0") + "\0");
  return { listPath, tempDir };
}
