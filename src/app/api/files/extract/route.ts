import { Readable } from "node:stream";
import { openManagedLocalFile } from "@/lib/storage/open-local-file";
import { randomUUID } from "node:crypto";
import { createLogger } from "@/lib/logging";
import { extractionJournal } from "@/lib/files/extraction-journal";
import { lockStorageFileOverwrite } from "@/lib/storage/file-overwrite-lock";
import { tryAcquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { publishLocalFile } from "@/lib/storage/publish-local-file";
import { apiCopy } from "@/lib/i18n/api-copy";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createWriteStream } from "node:fs";
import path from "node:path";
import fs from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { resolveStoragePathWithinBase } from "@/lib/storage/path-utils";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { assertNotRecycled, normalizeIndexedPath } from "@/lib/storage/archive-access";
import { assertStorageAccess, releaseStorageQuotaGuard } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { createFileEntry } from "@/lib/storage/service";
// Next.js route modules may only export route handlers and route config —
// the bomb-cap limiter lives in lib (unit-testable, importable).
import { GunzipOutputLimiter, MAX_GUNZIP_OUTPUT_BYTES, countGunzipOutput } from "@/lib/storage/gunzip-limiter";
import { ArchiveExtractError, archiveKindOf, extractArchive, planExtraction } from "@/lib/storage/archive-extract";
import { archiveErrorCopy } from "@/lib/storage/archive-error-copy";
import { syncLocalDirectoryEntries } from "@/lib/storage/local-sync";

import { ForbiddenError, NotFoundError, ValidationError, isAppError } from "@/lib/errors";
import { getErrorMessage } from "@/lib/http/error-message";

function streamFileHandle(handle: Awaited<ReturnType<typeof openManagedLocalFile>>): Readable {
  return Readable.from((async function* () {
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (true) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
      yield Buffer.from(chunk.subarray(0, bytesRead));
    }
  })());
}

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
      // Normalized as the index stores it: "dir//a.zip" otherwise slipped past the recycle-bin check below.
      const relativePath = normalizeIndexedPath((body.remotePath ?? body.relativePath ?? "").replaceAll("\\", "/"));

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

          const gzHandle = await openManagedLocalFile(node.basePath, relativePath);
          let release: (() => Promise<void>) | undefined;
          let unlockJournal: (() => Promise<void>) | undefined;
          let admission: Awaited<ReturnType<typeof assertStorageAccess>> | undefined;
          const staged = path.join(path.dirname(outputPath.path), `.vch-extract-${randomUUID()}.tmp`);
          try {
            unlockJournal = await tryAcquireAdvisoryLock("storage-file-operation", `extract:${node.id}:${relativePath.toLowerCase()}`) ?? undefined;
            if (!unlockJournal) {
              return NextResponse.json({ error: apiCopy("apiCopy.files.op.changed") }, { status: 409 });
            }
            const gzStat = await gzHandle.stat({ bigint: true });
            const journal = extractionJournal(node.id, relativePath, `${gzStat.dev}:${gzStat.ino}:${gzStat.size}:${gzStat.ctimeNs}`, session.userId, session.currentTeamId);
            const recovered = await journal.published(path.dirname(outputPath.path));
            const existingOutput = await prisma.fileEntry.findFirst({
              where: {
                storageNodeId: node.id,
                relativePath: outputRelativePath,
                isDeleted: false,
              },
              select: { id: true, size: true, entryType: true },
            });
            if (recovered) {
              release = await lockStorageFileOverwrite(node.id, outputRelativePath);
              if (!await journal.published(path.dirname(outputPath.path))) throw new Error("Archive output changed: " + outputRelativePath);
              await assertNotRecycled(node.id, outputRelativePath, "write", "LOCAL");
              admission = await assertStorageAccess({ session, storageNodeId: node.id, relativePath: outputRelativePath, operation: "write" });
              if (!admission.allowed) throw new ForbiddenError(storageAccessDeniedCopy(admission.reason));
              const size = recovered.members[0]?.size;
              if (size == null || size !== (await fs.lstat(outputPath.path)).size) {
                await journal.clear().catch(() => undefined);
                throw new Error("Archive output changed: " + outputRelativePath);
              }
              if (existingOutput && (existingOutput.entryType !== "FILE" || existingOutput.size !== BigInt(size))) throw new Error("Archive index mismatch at " + outputRelativePath);
              if (!existingOutput) await createFileEntry({ storageNodeId: node.id, name: outputName, entryType: "FILE", mimeType: "application/octet-stream", size, relativePath: outputRelativePath });
              await journal.clear(path.dirname(outputPath.path));
              return NextResponse.json({ message: apiCopy("apiCopy.extracted.to.the.current.directory.please.refresh.the.file.list..1d9a38e3", { v0: name }) });
            }
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

            // The output is admitted against the grant's per-file limit and quota
            // before a byte is written, like an upload of that size. Its size is
            // counted by decompressing without writing (the gzip trailer names
            // only the last member's size, so a multi-member file was refused);
            // the limiter below then writes exactly that much.
            const limitMessage = t("backend.storageHardening.extract.gzOutputTooLarge", locale);
            const declaredSize = await countGunzipOutput(streamFileHandle(gzHandle), MAX_GUNZIP_OUTPUT_BYTES, limitMessage);
            admission = await assertStorageAccess({ session, storageNodeId: node.id, relativePath: outputRelativePath,
              operation: "write", writeBytes: declaredSize });
            if (!admission.allowed) return NextResponse.json({ error: storageAccessDeniedCopy(admission.reason) }, { status: 403 });
            await pipeline(streamFileHandle(gzHandle), createGunzip(), new GunzipOutputLimiter(declaredSize, limitMessage),
              createWriteStream(staged, { flags: "wx", mode: 0o600 }), { signal: request.signal });
            release = await lockStorageFileOverwrite(node.id, outputRelativePath);
            await assertNotRecycled(node.id, outputRelativePath, "write", "LOCAL");
            const identity = await fs.stat(staged);
            await journal.prepare(outputName, [{ relativePath: outputRelativePath, size: identity.size }], staged);
            try {
              await publishLocalFile(staged, outputPath.path, outputRelativePath);
            } catch (error) {
              await journal.clear().catch(() => undefined);
              throw error;
            }
            try {
              await createFileEntry({
                storageNodeId: node.id, name: outputName, entryType: "FILE", mimeType: "application/octet-stream",
                size: identity.size, relativePath: outputRelativePath,
              });
            } catch (error) {
              const indexed = await prisma.fileEntry.findFirst({
                where: { storageNodeId: node.id, relativePath: outputRelativePath }, select: { id: true },
              });
              const current = await fs.lstat(outputPath.path);
              if (!indexed && current.dev === identity.dev && current.ino === identity.ino) {
                await fs.unlink(outputPath.path);
                await journal.clear();
              }
              throw error;
            }
            await journal.clear();
          } finally {
            await gzHandle.close().catch(() => undefined);
            await fs.rm(staged, { force: true }).catch(() => undefined);
            try { await release?.(); } finally {
              try { await releaseStorageQuotaGuard(admission); } finally { await unlockJournal?.(); }
            }
          }
        } else if (archiveKindOf(formatName)) {
          // ZIP and tar are read in-process and written as plain files and
          // folders only (links and devices are skipped), into a new folder
          // beside the archive; see lib/storage/archive-extract.ts.
          const kind = archiveKindOf(formatName)!;
          const parentRelative = writeRelativePath === "." ? "" : writeRelativePath;
          const parentDir = path.dirname(fullPath);
          const asValidation = (error: unknown): never => {
            if (error instanceof ArchiveExtractError) throw new ValidationError(archiveErrorCopy(error));
            throw error;
          };
          const archiveHandle = await openManagedLocalFile(node.basePath, relativePath);
          const pinnedArchivePath = process.platform === "linux" ? `/proc/self/fd/${archiveHandle.fd}` : fullPath;
          let admission: Awaited<ReturnType<typeof assertStorageAccess>> | undefined;
          let unlock: (() => Promise<void>) | undefined;
          try {
            unlock = await tryAcquireAdvisoryLock("storage-file-operation", `extract:${node.id}:${relativePath.toLowerCase()}`) ?? undefined;
            if (!unlock) {
              return NextResponse.json({ error: apiCopy("apiCopy.files.op.changed") }, { status: 409 });
            }
            const st = await archiveHandle.stat({ bigint: true });
            const journal = extractionJournal(node.id, relativePath, `${st.dev}:${st.ino}:${st.size}:${st.ctimeNs}`, session.userId, session.currentTeamId);
            const recovered = await journal.published(parentDir);
            const plan = await planExtraction(pinnedArchivePath, kind, request.signal).catch(asValidation);
            // Pre-flight capacity check before writing extracted files to staging.
            const preflightFolder = path.posix.join(parentRelative, formatName.replace(/\.(?:tar\.(?:gz|bz2|xz)|tgz|tbz2|txz|zip|tar)$/i, "") || "extracted");
            if (!recovered) {
              const preflight = await assertStorageAccess({
                session, storageNodeId: node.id, relativePath: preflightFolder, operation: "write",
                writeBytes: plan.totalBytes, largestFileBytes: plan.largestFileBytes,
              });
              if (!preflight.allowed) throw new ForbiddenError(storageAccessDeniedCopy(preflight.reason));
              await releaseStorageQuotaGuard(preflight);
            }
            const admit = async (folderName: string, members: { relativePath: string; size: number | null }[]) => {
                const folder = path.posix.join(parentRelative, folderName);
                await assertNotRecycled(node.id, folder, "write", node.driver);
                await releaseStorageQuotaGuard(admission);
                admission = await assertStorageAccess({
                  session, storageNodeId: node.id, relativePath: folder, operation: "write",
                  ...(recovered ? {} : { writeBytes: plan.totalBytes, largestFileBytes: plan.largestFileBytes }), writeMembers: members,
                });
                if (!admission.allowed) throw new ForbiddenError(storageAccessDeniedCopy(admission.reason));
            };
            if (recovered) await admit(recovered.folderName, recovered.members);
            const result = recovered ? { ...plan, ...recovered, createdDirectories: recovered.members.filter(m => m.size === null).map(m => path.join(node.basePath, m.relativePath)) }
              : await extractArchive({
                filePath: pinnedArchivePath, kind, archiveName: formatName, parentDir, parentRelativePath: parentRelative, plan, signal: request.signal,
                beforePublish: async (folderName, members, source) => {
                  await admit(folderName, members);
                  await journal.prepare(folderName, members, source);
                },
                onCollision: source => fs.unlink(path.join(source, journal.marker)),
              }).catch(async (error): Promise<never> => {
                if (!(await journal.published(parentDir).catch(() => null))) {
                  await journal.clear().catch(() => undefined);
                }
                return asValidation(error);
              });
            // Index the new folder and everything under it, so listings and
            // search show the files without visiting each folder first.
            const folder = path.posix.join(parentRelative, result.folderName);
            const directories = [parentRelative, ...result.createdDirectories.map(directory =>
              path.posix.join(parentRelative, path.relative(parentDir, directory).split(path.sep).join("/")))];
            try {
              if (!await journal.published(parentDir)) throw new Error("Archive output changed: " + folder);
              for (const directory of directories) {
                const sync = await syncLocalDirectoryEntries({ node, relativePath: directory || undefined });
                if (sync.errors.length) throw new Error(sync.errors.join("; "));
              }
              // A sync can legitimately skip an existing tombstone or lose an insert race. Check each
              // published member before reporting success, including implicit directory entries.
              for (let offset = 0; offset < result.members.length; offset += 500) {
                const members = result.members.slice(offset, offset + 500);
                const rows = await prisma.fileEntry.findMany({
                  where: { storageNodeId: node.id, isDeleted: false, relativePath: { in: members.map(member => member.relativePath) } },
                  select: { relativePath: true, entryType: true, size: true },
                });
                const indexed = new Map(rows.map(row => [row.relativePath, row]));
                for (const member of members) {
                  const row = indexed.get(member.relativePath);
                  const matches = member.size === null ? row?.entryType === "DIRECTORY"
                    : row?.entryType === "FILE" && row.size === BigInt(member.size);
                  if (!matches) throw new Error("Archive index mismatch at " + member.relativePath);
                }
              }
            } catch (error) {
              createLogger("storage:extract").error("Published archive requires index reconciliation", { storageNodeId: node.id, folder, error });
              return NextResponse.json({
                error: t("storagePage.action.indexWriteFailed", locale), folder, indexStatus: "reconciliation_required",
              }, { status: 500 });
            }
            await journal.clear(parentDir);
            return NextResponse.json({
              message: result.skipped
                ? apiCopy("apiCopy.archive.extractedSkipped", { v0: result.files, v1: result.folderName, v2: result.skipped })
                : apiCopy("apiCopy.archive.extracted", { v0: result.files, v1: result.folderName }),
              folder: path.posix.join(parentRelative, result.folderName),
              files: result.files,
              directories: result.createdDirectories.length,
              skipped: result.skipped,
            });
          } finally {
            await archiveHandle.close().catch(() => undefined);
            try { await releaseStorageQuotaGuard(admission); } finally { await unlock?.(); }
          }
        } else {
          return NextResponse.json(
            { error: apiCopy("apiCopy.archive.unsupportedFormat") },
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
