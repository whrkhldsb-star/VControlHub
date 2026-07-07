import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { AuthError, NotFoundError, ValidationError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { compressFilesBodySchema } from "@/lib/files/schema";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { createFileEntry } from "@/lib/storage/service";
import { resolveStoragePathWithinBase } from "@/lib/storage/path-utils";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "Compression failed",
      bodySchema: compressFilesBodySchema,
    },
    async ({ session, body }) => {
      if (!session) throw new AuthError("Unauthorized");

      const { storageNodeId, relativePaths, targetDir } = body;
      const outputName = normalizeArchiveName(body.outputName);
      const targetRelativeDir = normalizeDir(targetDir ?? path.posix.dirname(relativePaths[0] ?? ""));
      const outputRelativePath = path.posix.join(targetRelativeDir, outputName);

      const node = await prisma.storageNode.findUnique({
        where: { id: storageNodeId },
        select: { id: true, driver: true, basePath: true },
      });
      if (!node) throw new NotFoundError("Storage node not found");
      if (node.driver !== "LOCAL") {
        return NextResponse.json({ error: "Only local storage node batch compression is supported" }, { status: 400 });
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
        return NextResponse.json({ error: `Target archive /${outputRelativePath} already exists` }, { status: 409 });
      }

      const inputs: string[] = [];
      for (const rawRelativePath of relativePaths) {
        const relativePath = rawRelativePath.replace(/^\/+/, "");
        if (relativePath === outputRelativePath) {
          return NextResponse.json({ error: "Cannot include the target archive in itself" }, { status: 400 });
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
        if (!await pathExists(resolved.path)) throw new NotFoundError(`File not found: /${relativePath}`);
        inputs.push(relativePath);
      }

      await fs.mkdir(path.dirname(outputResolved.path), { recursive: true });
      const listPath = await writeTarList(inputs);
      try {
        await execFileAsync("tar", ["-czf", outputResolved.path, "-C", node.basePath, "--null", "-T", listPath], {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 120_000,
        });
      } catch (error) {
        await fs.rm(outputResolved.path, { force: true });
        const message = error instanceof Error ? error.message : "tar command failed";
        return NextResponse.json({ error: `Compression failed: ${message}` }, { status: 500 });
      } finally {
        await fs.rm(listPath, { force: true });
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
        message: `Created archive /${outputRelativePath}`,
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
  const listPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "vch-compress-")), "files.txt");
  await fs.writeFile(listPath, relativePaths.join("\0") + "\0");
  return listPath;
}
