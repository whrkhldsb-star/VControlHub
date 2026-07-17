import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import { resolveStoragePathWithinBase } from "@/lib/storage/path-utils";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { createFileEntry } from "@/lib/storage/service";

import { AuthError, NotFoundError, ValidationError } from "@/lib/errors";
const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

const postSchema = z
  .object({
    storageNodeId: z.string().min(1).optional(),
    serverId: z.string().min(1).optional(),
    remotePath: z.string().min(1),
    targetDir: z.string().optional(),
    driver: z.string().optional(),
    name: z.string().optional(),
  })
  .refine((value) => value.storageNodeId || value.serverId, {
    message: "Missing storageNodeId",
    path: ["storageNodeId"],
  });

export async function POST(request: NextRequest) {
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "Extraction failed",
      bodySchema: postSchema,
    },
    async ({ session, body }) => {
      if (!session)
        throw new AuthError("Unauthorized");

      const driver = body.driver ?? "LOCAL";
      const name = body.name ?? "archive";
      const nodeId = body.storageNodeId ?? body.serverId;
      const relativePath = body.remotePath.replace(/^\/+/, "");

      if (driver !== "LOCAL") {
        return NextResponse.json(
          { error: "Only local storage node archive extraction is supported" },
          { status: 400 },
        );
      }

      if (!nodeId || !relativePath) {
        throw new ValidationError("Missing required parameters");
      }

      const node = await prisma.storageNode.findFirst({
        where: { id: nodeId, ...teamWhere(session) },
        select: { id: true, name: true, driver: true, basePath: true },
      });
      if (!node) {
        throw new NotFoundError("Storage node not found");
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

      const accessDecision = await assertStorageAccess({
        session,
        storageNodeId: node.id,
        relativePath,
        operation: "read",
      });
      if (!accessDecision.allowed) {
        return NextResponse.json(
          { error: accessDecision.reason ?? "No access permission for this storage node or path" },
          { status: 403 },
        );
      }

      const writeAccessDecision = await assertStorageAccess({
        session,
        storageNodeId: node.id,
        relativePath:
          body.targetDir?.trim() || path.posix.dirname(relativePath),
        operation: "write",
      });
      if (!writeAccessDecision.allowed) {
        return NextResponse.json(
          {
            error:
              writeAccessDecision.reason ??
              "No write permission for this storage node or target directory",
          },
          { status: 403 },
        );
      }

      const fullPath = resolvedPath.path;
      // Verify the file exists
      try {
        await fs.access(fullPath);
      } catch {
        throw new NotFoundError("File not found");
      }

      const lowerName = name.toLowerCase();
      const ext = path.extname(lowerName);

      try {
        if (ext === ".gz" && !lowerName.endsWith(".tar.gz")) {
          const outputName = name.replace(/\.gz$/i, "");
          const outputRelativePath = path.posix.join(
            path.posix.dirname(relativePath),
            outputName,
          );
          const outputPath = resolveStoragePathWithinBase(
            node.basePath,
            outputRelativePath,
          );
          if (!outputPath.ok) {
            return NextResponse.json(
              { error: outputPath.reason },
              { status: 400 },
            );
          }

          const existingOutput = await prisma.fileEntry.findFirst({
            where: {
              storageNodeId: node.id,
              relativePath: outputRelativePath,
              isDeleted: false,
            },
            select: { id: true },
          });
          if (existingOutput) {
            return NextResponse.json(
              { error: `Target file /${outputRelativePath} already exists` },
              { status: 409 },
            );
          }

          try {
            await fs.access(outputPath.path);
            return NextResponse.json(
              { error: `Target file /${outputRelativePath} already exists` },
              { status: 409 },
            );
          } catch {
            // Expected: gunzip should create this file.
          }

          await execFileAsync("gunzip", ["-k", fullPath], {
            maxBuffer: 10 * 1024 * 1024,
            timeout: 60000,
          });

          let outputStat;
          try {
            outputStat = await fs.stat(outputPath.path);
          } catch {
            return NextResponse.json(
              { error: "Extraction command completed but output file not found" },
              { status: 500 },
            );
          }

          try {
            await createFileEntry({
              storageNodeId: node.id,
              name: outputName,
              entryType: "FILE",
              mimeType: "application/octet-stream",
              size: outputStat.size,
              relativePath: outputRelativePath,
            });
          } catch (error) {
            try {
              await fs.unlink(outputPath.path);
            } catch {
              // Best-effort cleanup: keep the original indexing error visible.
            }
            throw error;
          }
        } else if (ext === ".zip" || ext === ".jar") {
          return NextResponse.json(
            {
              error:
                "To avoid symlink/hardlink traversal risks, online extraction of zip/jar is not supported. Please extract in a trusted environment first",
            },
            { status: 400 },
          );
        } else if (
          lowerName.endsWith(".tar.gz") ||
          lowerName.endsWith(".tgz")
        ) {
          return NextResponse.json(
            {
              error:
                "To avoid symlink/hardlink traversal risks, online extraction of tar/tgz is not supported. Please extract in a trusted environment first",
            },
            { status: 400 },
          );
        } else if (ext === ".tar") {
          return NextResponse.json(
            {
              error:
                "To avoid symlink/hardlink traversal risks, online extraction of tar is not supported. Please extract in a trusted environment first",
            },
            { status: 400 },
          );
        } else if (ext === ".7z" || ext === ".rar") {
          return NextResponse.json(
            {
              error:
                "To avoid symlink/hardlink traversal risks, online extraction of 7z/RAR is not supported. Please extract in a trusted environment first",
            },
            { status: 400 },
          );
        } else {
          return NextResponse.json(
            { error: `Unsupported archive format: ${ext}` },
            { status: 400 },
          );
        }

        return NextResponse.json({
          message: `Extracted ${name} to the current directory, please refresh the file list to view`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Extraction failed";
        return NextResponse.json(
          { error: `Extraction failed: ${message}` },
          { status: 500 },
        );
      }
    },
  );
}
