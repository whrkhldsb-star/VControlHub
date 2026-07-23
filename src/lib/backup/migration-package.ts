/**
 * Cross-environment backup migration packages.
 *
 * Design (safe, portable, non-destructive by default):
 * 1) Export a COMPLETED BackupRecord into a self-describing package:
 *      migration-packages/<id>/
 *        manifest.json
 *        payload.<ext>          (copy of backup artifact)
 * 2) Import a package directory (or tarball path under backup root):
 *      validate manifest + sha256 of payload
 *      copy payload into portable backups/ path
 *      create COMPLETED BackupRecord ready for restore/drill
 * 3) Wizard never auto-restores; restore still requires RESTORE confirm
 *    via the existing restore pipeline.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { BusinessError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createLogger } from "@/lib/logging";

import { t } from "@/lib/i18n/translations";
import {
  assertPortableBackupPath,
  buildBackupFilePath,
  getBackupStorageRoot,
  isBackupType,
  resolveBackupPath,
  type BackupType,
} from "./service-types";

const runFile = promisify(execFile);
const logger = createLogger("backup:migration");

export const MIGRATION_MANIFEST_VERSION = 1 as const;
export const MIGRATION_PACKAGE_DIR = "migration-packages";

export type MigrationManifest = {
  version: typeof MIGRATION_MANIFEST_VERSION;
  packageId: string;
  createdAt: string;
  source: {
    app: "VControlHub";
    hostname: string;
    recordId: string;
    teamId: string | null;
  };
  backup: {
    type: BackupType;
    originalFilePath: string;
    payloadFileName: string;
    fileSize: number;
    checksumSha256: string;
    note: string | null;
    completedAt: string | null;
  };
  instructions: {
    import: string;
    restore: string;
  };
};

export type MigrationExportResult = {
  packageId: string;
  packageRelativeDir: string;
  manifestRelativePath: string;
  payloadRelativePath: string;
  absoluteDir: string;
  manifest: MigrationManifest;
};

export type MigrationValidateResult = {
  ok: boolean;
  packageDir: string;
  manifest: MigrationManifest;
  payloadAbsolutePath: string;
  checksumMatches: boolean;
  sizeMatches: boolean;
  issues: string[];
};

export type MigrationImportResult = {
  backupId: string;
  filePath: string;
  type: BackupType;
  checksumSha256: string;
  fileSize: number;
  packageId: string;
  manifest: MigrationManifest;
};

function projectRoot(): string {
  return config.app.appDir || process.cwd();
}

function packagesRoot(root = projectRoot()): string {
  return join(getBackupStorageRoot(root), MIGRATION_PACKAGE_DIR);
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function payloadExtension(type: BackupType, originalPath: string): string {
  const ext = extname(originalPath);
  if (ext) return ext.replace(/^\./, "") || (type === "DATABASE" ? "sql.gz" : "tar.gz");
  return type === "DATABASE" ? "sql.gz" : "tar.gz";
}

function assertSafePackageId(id: string): string {
  const value = id.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,80}$/.test(value)) {
    throw new ValidationError(t("backend.backup.migrationIdInvalid"));
  }
  return value;
}

/**
 * Resolve a user-supplied package location to an absolute directory under
 * the backup storage root. Accepts:
 *  - migration-packages/<id>
 *  - absolute path already under backup root
 *  - path to a .tar.gz package that will be extracted into a temp dir
 */
export async function resolveMigrationPackageDir(
  packageRef: string,
  root = projectRoot(),
): Promise<{ packageDir: string; cleanup?: () => Promise<void> }> {
  const ref = packageRef.trim();
  if (!ref) throw new ValidationError(t("backend.backup.packagePathRequired"));

  const storageRoot = getBackupStorageRoot(root);
  let candidate = ref;

  if (!ref.startsWith("/")) {
    // portable relative under backup root
    const portable = assertPortableBackupPath(ref.replace(/^\.?\//, ""));
    candidate = join(storageRoot, portable);
  }

  // must stay under storage root (path-boundary, not naive string prefix)
  const resolvedRoot = resolve(storageRoot);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel.startsWith("..") || rel === ".." || resolve(resolvedRoot, rel) !== resolvedCandidate) {
    throw new ValidationError(t("backend.backup.packageOutsideRoot"));
  }
  candidate = resolvedCandidate;

  const info = await stat(candidate).catch(() => null);
  if (!info) throw new NotFoundError(t("backend.backup.packagePathNotFound"));

  if (info.isDirectory()) {
    return { packageDir: candidate };
  }

  // file: only accept .tar.gz under storage root — extract to temp under packages root
  if (!candidate.endsWith(".tar.gz") && !candidate.endsWith(".tgz")) {
    throw new ValidationError(t("backend.backup.packageMustBeDirOrTgz"));
  }

  const extractId = `import-${randomUUID().slice(0, 12)}`;
  const extractDir = join(packagesRoot(root), extractId);
  await mkdir(extractDir, { recursive: true });
  try {
    // Prefer GNU tar --restrict when available; always re-verify no path escape after extract.
    await runFile("tar", ["-xzf", candidate, "-C", extractDir, "--restrict"], {
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
    }).catch(async () => {
      // BusyBox/older tar may not support --restrict; fall back then verify members.
      await runFile("tar", ["-xzf", candidate, "-C", extractDir], {
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
      });
    });
  } catch (error) {
    await rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
    throw new BusinessError(
      `Failed to extract migration package: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Reject path traversal / absolute members that land outside extractDir.
  const { readdir } = await import("node:fs/promises");
  async function assertNoEscape(dir: string, rootAbs: string): Promise<void> {
    const kids = await readdir(dir, { withFileTypes: true });
    for (const kid of kids) {
      const abs = resolve(dir, kid.name);
      const relPath = relative(rootAbs, abs);
      if (relPath.startsWith("..") || relPath === ".." || resolve(rootAbs, relPath) !== abs) {
        throw new ValidationError(t("backend.backup.packageOutsideRoot"));
      }
      if (kid.isDirectory()) await assertNoEscape(abs, rootAbs);
    }
  }
  try {
    await assertNoEscape(extractDir, resolve(extractDir));
  } catch (error) {
    await rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  // If archive contains a single top-level dir, use it
  const entries = await readdir(extractDir);
  let packageDir = extractDir;
  if (entries.length === 1) {
    const only = join(extractDir, entries[0]!);
    const onlyStat = await stat(only);
    if (onlyStat.isDirectory()) packageDir = only;
  }

  return {
    packageDir,
    cleanup: async () => {
      await rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

export async function readMigrationManifest(packageDir: string): Promise<MigrationManifest> {
  const manifestPath = join(packageDir, "manifest.json");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    throw new ValidationError(t("backend.backup.manifestMissing"));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationError(t("backend.backup.manifestInvalidJson"));
  }
  const m = parsed as Partial<MigrationManifest>;
  if (m.version !== MIGRATION_MANIFEST_VERSION) {
    throw new ValidationError(`Unsupported migration manifest version: ${String(m.version)}`);
  }
  if (!m.packageId || !m.backup?.type || !m.backup.payloadFileName || !m.backup.checksumSha256) {
    throw new ValidationError(t("backend.backup.manifestMissingFields"));
  }
  if (!isBackupType(m.backup.type)) {
    throw new ValidationError(`Invalid backup type in manifest: ${m.backup.type}`);
  }
  return m as MigrationManifest;
}

export async function validateMigrationPackage(
  packageRef: string,
  root = projectRoot(),
): Promise<MigrationValidateResult & { cleanup?: () => Promise<void> }> {
  const resolved = await resolveMigrationPackageDir(packageRef, root);
  const issues: string[] = [];
  let manifest: MigrationManifest;
  try {
    manifest = await readMigrationManifest(resolved.packageDir);
  } catch (error) {
    if (resolved.cleanup) await resolved.cleanup();
    throw error;
  }

  const payloadAbsolutePath = join(resolved.packageDir, manifest.backup.payloadFileName);
  try {
    await access(payloadAbsolutePath);
  } catch {
    issues.push(`payload missing: ${manifest.backup.payloadFileName}`);
  }

  let checksumMatches = false;
  let sizeMatches = false;
  if (issues.length === 0) {
    const info = await stat(payloadAbsolutePath);
    sizeMatches = info.size === manifest.backup.fileSize;
    if (!sizeMatches) {
      issues.push(
        `payload size mismatch: expected ${manifest.backup.fileSize}, got ${info.size}`,
      );
    }
    const digest = await sha256File(payloadAbsolutePath);
    checksumMatches = digest.toLowerCase() === manifest.backup.checksumSha256.toLowerCase();
    if (!checksumMatches) {
      issues.push("payload sha256 does not match manifest");
    }
  }

  return {
    ok: issues.length === 0,
    packageDir: resolved.packageDir,
    manifest,
    payloadAbsolutePath,
    checksumMatches,
    sizeMatches,
    issues,
    cleanup: resolved.cleanup,
  };
}

export async function exportMigrationPackage(input: {
  backupId: string;
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;
  projectRoot?: string;
  note?: string;
}): Promise<MigrationExportResult> {
  const root = input.projectRoot || projectRoot();
  const record = input.session
    ? await prisma.backupRecord.findFirst({
        where: { id: input.backupId, ...teamWhere(input.session) },
      })
    : await prisma.backupRecord.findUnique({ where: { id: input.backupId } });

  if (!record) throw new NotFoundError(t("backend.backup.recordNotFound"));
  if (record.status !== "COMPLETED") {
    throw new BusinessError(t("backend.backup.onlyCompletedCanMigrate"));
  }
  if (!isBackupType(record.type)) throw new ValidationError(t("backend.backup.invalidType"));

  const sourcePath = resolveBackupPath(root, record.filePath);
  const sourceInfo = await stat(sourcePath).catch(() => null);
  if (!sourceInfo?.isFile()) {
    throw new BusinessError(t("backend.backup.artifactMissing"));
  }

  const checksum =
    record.checksumSha256 && record.checksumSha256.length >= 32
      ? record.checksumSha256
      : await sha256File(sourcePath);

  const packageId = `mig-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const packageRelativeDir = `${MIGRATION_PACKAGE_DIR}/${packageId}`;
  const absoluteDir = join(getBackupStorageRoot(root), packageRelativeDir);
  await mkdir(absoluteDir, { recursive: true });

  const ext = payloadExtension(record.type, record.filePath);
  const payloadFileName = `payload.${ext}`;
  const payloadAbsolute = join(absoluteDir, payloadFileName);
  await copyFile(sourcePath, payloadAbsolute);
  const payloadInfo = await stat(payloadAbsolute);

  const manifest: MigrationManifest = {
    version: MIGRATION_MANIFEST_VERSION,
    packageId,
    createdAt: new Date().toISOString(),
    source: {
      app: "VControlHub",
      hostname: config.app.hostname || "unknown",
      recordId: record.id,
      teamId: record.teamId ?? null,
    },
    backup: {
      type: record.type,
      originalFilePath: record.filePath,
      payloadFileName,
      fileSize: payloadInfo.size,
      checksumSha256: checksum,
      note: input.note?.trim() || record.note || null,
      completedAt: record.completedAt?.toISOString() ?? null,
    },
    instructions: {
      import:
        "On the target VControlHub host: place this package under BACKUP_DIR/migration-packages/ (or upload), then use Migration Wizard → Import & Register. Validation checks sha256 before creating a COMPLETED BackupRecord.",
      restore:
        "After import, use the normal Restore flow with confirmation text RESTORE. Prefer restore drill first for non-destructive verification.",
    },
  };

  const manifestAbsolute = join(absoluteDir, "manifest.json");
  await writeFile(manifestAbsolute, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  // Optional convenience tarball next to the directory
  const tarRelative = `${packageRelativeDir}.tar.gz`;
  const tarAbsolute = join(getBackupStorageRoot(root), tarRelative);
  try {
    await runFile(
      "tar",
      ["-czf", tarAbsolute, "-C", dirname(absoluteDir), basename(absoluteDir)],
      { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 },
    );
  } catch (error) {
    logger.warn("migration package tarball creation failed (directory package still valid)", {
      packageId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info("migration package exported", {
    packageId,
    backupId: record.id,
    type: record.type,
    size: payloadInfo.size,
  });

  return {
    packageId,
    packageRelativeDir,
    manifestRelativePath: `${packageRelativeDir}/manifest.json`,
    payloadRelativePath: `${packageRelativeDir}/${payloadFileName}`,
    absoluteDir,
    manifest,
  };
}

export async function importMigrationPackage(input: {
  packageRef: string;
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;
  projectRoot?: string;
  note?: string;
}): Promise<MigrationImportResult> {
  const root = input.projectRoot || projectRoot();
  const validated = await validateMigrationPackage(input.packageRef, root);
  try {
    if (!validated.ok) {
      throw new ValidationError(
        `Migration package validation failed: ${validated.issues.join("; ")}`,
      );
    }

    const { manifest, payloadAbsolutePath } = validated;
    // Team isolation: non-admin may only import packages exported for their team
    // (or legacy packages with null source.teamId).
    const sourceTeamId = manifest.source?.teamId ?? null;
    const session = input.session;
    if (
      session &&
      !session.roles?.includes("admin") &&
      session.currentTeamId &&
      sourceTeamId !== null &&
      sourceTeamId !== session.currentTeamId
    ) {
      throw new ForbiddenError("Cannot import migration package from another team");
    }
    const type = manifest.backup.type;
    const portablePath = buildBackupFilePath(type);
    assertPortableBackupPath(portablePath);
    const destAbsolute = resolveBackupPath(root, portablePath);
    await mkdir(dirname(destAbsolute), { recursive: true });
    await copyFile(payloadAbsolutePath, destAbsolute);

    const fileInfo = await stat(destAbsolute);
    const checksum = await sha256File(destAbsolute);
    if (checksum.toLowerCase() !== manifest.backup.checksumSha256.toLowerCase()) {
      await rm(destAbsolute, { force: true }).catch(() => undefined);
      throw new BusinessError(t("backend.backup.importChecksumMismatch"));
    }

    const noteParts = [
      `Imported migration package ${manifest.packageId}`,
      `sourceHost=${manifest.source.hostname}`,
      `sourceRecord=${manifest.source.recordId}`,
      input.note?.trim() || "",
      manifest.backup.note || "",
    ].filter(Boolean);

    const record = await prisma.backupRecord.create({
      data: {
        type,
        status: "COMPLETED",
        filePath: portablePath,
        fileSize: String(fileInfo.size),
        checksumSha256: checksum,
        note: noteParts.join(" | ").slice(0, 1000),
        completedAt: new Date(),
        createdBy: input.session?.userId ?? null,
        teamId: input.session?.currentTeamId ?? null,
      },
    });

    logger.info("migration package imported", {
      packageId: manifest.packageId,
      backupId: record.id,
      type,
      size: fileInfo.size,
    });

    return {
      backupId: record.id,
      filePath: portablePath,
      type,
      checksumSha256: checksum,
      fileSize: fileInfo.size,
      packageId: manifest.packageId,
      manifest,
    };
  } finally {
    if (validated.cleanup) await validated.cleanup();
  }
}

/** List exported package directories under migration-packages/. */
export async function listMigrationPackages(
  root = projectRoot(),
  session?: { currentTeamId: string | null; roles?: string[] } | null,
): Promise<
  Array<{
    packageId: string;
    relativeDir: string;
    createdAt: string | null;
    type: string | null;
    fileSize: number | null;
    hasTarball: boolean;
    sourceTeamId?: string | null;
  }>
> {
  const rootDir = packagesRoot(root);
  try {
    await access(rootDir);
  } catch {
    return [];
  }
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(rootDir, { withFileTypes: true });
  const results: Array<{
    packageId: string;
    relativeDir: string;
    createdAt: string | null;
    type: string | null;
    fileSize: number | null;
    hasTarball: boolean;
    sourceTeamId?: string | null;
  }> = [];

  // Non-admin team sessions only see packages whose manifest source.teamId matches
  // (or legacy null packages — still visible under teamWhere-null policy).
  const isAdmin = Boolean(session?.roles?.includes("admin"));
  const teamId = session?.currentTeamId ?? null;
  const filterByTeam = Boolean(session && teamId && !isAdmin);

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const packageId = assertSafePackageId(entry.name);
      const relativeDir = `${MIGRATION_PACKAGE_DIR}/${packageId}`;
      const dir = join(rootDir, packageId);
      const manifest = await readMigrationManifest(dir).catch(() => null);
      const sourceTeamId = manifest?.source?.teamId ?? null;
      // Team-scoped list: only packages stamped with this team (exclude other teams and unscoped).
      if (filterByTeam && sourceTeamId !== teamId) {
        continue;
      }
      const tarPath = join(getBackupStorageRoot(root), `${relativeDir}.tar.gz`);
      const hasTarball = await stat(tarPath)
        .then((s) => s.isFile())
        .catch(() => false);
      results.push({
        packageId,
        relativeDir,
        createdAt: manifest?.createdAt ?? null,
        type: manifest?.backup.type ?? null,
        fileSize: manifest?.backup.fileSize ?? null,
        hasTarball,
        sourceTeamId,
      });
    } catch {
      // skip non-package dirs
    }
  }

  return results.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

