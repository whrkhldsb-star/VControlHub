import { apiCopy } from "@/lib/i18n/api-copy";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import fs from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { resolveStoragePathWithinBase } from "@/lib/storage/path-utils";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { createFileEntry } from "@/lib/storage/service";
// Next.js route modules may only export route handlers and route config —
// the bomb-cap limiter lives in lib (unit-testable, importable).
import { GunzipOutputLimiter, MAX_GUNZIP_OUTPUT_BYTES } from "@/lib/storage/gunzip-limiter";

import { NotFoundError, ValidationError, isAppError } from "@/lib/errors";
import { getErrorMessage } from "@/lib/http/error-message";

export const dynamic = "force-dynamic";

const postSchema = z
  .object({
    storageNodeId: z.string().min(1).optional(),
    // Client archive preview posts nodeId (alias of storageNodeId)
    nodeId: z.string().min(1).optional(),
    serverId: z.string().min(1).optional(),
    remotePath: z.string().min(1).optional(),
    // Client archive preview posts relativePath (alias of remotePath)
    relativePath: z.string().min(1).optional(),
    targetDir: z.string().optional(),
    driver: z.string().optional(),
    name: z.string().optional(),
  })
  .refine((value) => value.storageNodeId || value.nodeId || value.serverId, {
    message: "Missing storageNodeId",
    path: ["storageNodeId"],
  })
  .refine((value) => value.remotePath || value.relativePath, {
    message: "Missing remotePath",
    path: ["remotePath"],
  });

export async function POST(request: NextRequest) {
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: apiCopy("apiCopy.extraction.failed.ed874a99"),
      bodySchema: postSchema,
    },
    async ({ session, body }) => {
      const locale = await getServerLocale();

      const name = body.name ?? "archive";
      const nodeId = body.storageNodeId ?? body.nodeId ?? body.serverId;
      const relativePath = (body.remotePath ?? body.relativePath ?? "").replace(/^\/+/, "");

      if (!nodeId || !relativePath) {
        throw new ValidationError(apiCopy("apiCopy.missing.required.parameters.656b8ae6"));
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
          { error: apiCopy("apiCopy.only.local.storage.node.archive.extraction.is.supported.05e9679f") },
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

      // gunzip -k always writes beside the archive (dirname(relativePath));
      // do not ACL-check a caller-supplied targetDir that is never used.
      const writeRelativePath = path.posix.dirname(relativePath) || ".";
      const writeAccessDecision = await assertStorageAccess({
        session,
        storageNodeId: node.id,
        relativePath: writeRelativePath,
        operation: "write",
      });
      if (!writeAccessDecision.allowed) {
        return NextResponse.json(
          { error: storageAccessDeniedCopy(writeAccessDecision.reason) },
          { status: 403 },
        );
      }

      const fullPath = resolvedPath.path;
      // Verify the file exists
      try {
        await fs.access(fullPath);
      } catch {
        throw new NotFoundError(apiCopy("apiCopy.file.not.found.3521021a"));
      }

      // Prefer remote/relative path basename for format detection; client `name` is fallback only.
      const formatName = path.basename(relativePath) || name;
      const lowerName = formatName.toLowerCase();
      const ext = path.extname(lowerName);

      try {
        if (ext === ".gz" && !lowerName.endsWith(".tar.gz")) {
          const outputName = formatName.replace(/\.gz$/i, "");
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
              { error: apiCopy("apiCopy.target.file.already.exists.0c91e640", { v0: String(outputRelativePath) }) },
              { status: 409 },
            );
          }

          try {
            await fs.access(outputPath.path);
            return NextResponse.json(
              { error: apiCopy("apiCopy.target.file.already.exists.0c91e640", { v0: String(outputRelativePath) }) },
              { status: 409 },
            );
          } catch {
            // Expected: gunzip should create this file.
          }

          // Decompress with Node's zlib instead of the gunzip binary: same
          // "keep original, write output beside it" semantics without a
          // platform-specific executable (Windows/minimal images have no gzip).
          // The counting limiter aborts the pipeline mid-stream when the
          // decompressed size blows the cap; the partial file is removed below.
          try {
            await pipeline(
              createReadStream(fullPath),
              createGunzip(),
              new GunzipOutputLimiter(
                MAX_GUNZIP_OUTPUT_BYTES,
                t("backend.storageHardening.extract.gzOutputTooLarge", locale),
              ),
              createWriteStream(outputPath.path),
            );
          } catch (error) {
            await fs.unlink(outputPath.path).catch(() => undefined);
            throw error;
          }

          let outputStat;
          try {
            outputStat = await fs.stat(outputPath.path);
          } catch {
            return NextResponse.json(
              { error: apiCopy("apiCopy.extraction.command.completed.but.output.file.not.found.29140104") },
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
                apiCopy("apiCopy.to.avoid.symlink.hardlink.traversal.risks.online.extraction.of.z.283ea5fc"),
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
                apiCopy("apiCopy.to.avoid.symlink.hardlink.traversal.risks.online.extraction.of.t.48a2913a"),
            },
            { status: 400 },
          );
        } else if (ext === ".tar") {
          return NextResponse.json(
            {
              error:
                apiCopy("apiCopy.to.avoid.symlink.hardlink.traversal.risks.online.extraction.of.t.6dd7a102"),
            },
            { status: 400 },
          );
        } else if (ext === ".7z" || ext === ".rar") {
          return NextResponse.json(
            {
              error:
                apiCopy("apiCopy.to.avoid.symlink.hardlink.traversal.risks.online.extraction.of.7.f94ae3bb"),
            },
            { status: 400 },
          );
        } else {
          return NextResponse.json(
            { error: apiCopy("apiCopy.unsupported.archive.format.d8dab752", { v0: String(ext) }) },
            { status: 400 },
          );
        }

        return NextResponse.json({
          message: apiCopy("apiCopy.extracted.to.the.current.directory.please.refresh.the.file.list..1d9a38e3", { v0: String(name) }),
        });
      } catch (err) {
        // Typed errors (e.g. the 413 from the gunzip output limiter above)
        // already carry the real status and copy — let withApiRoute render
        // them instead of flattening everything into the generic 500.
        if (isAppError(err)) throw err;
        const message = getErrorMessage(err, "Extraction failed");
        return NextResponse.json(
          { error: apiCopy("apiCopy.extraction.failed.262e39d0", { v0: String(message) }) },
          { status: 500 },
        );
      }
    },
  );
}
