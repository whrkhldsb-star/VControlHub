import { z } from "zod";
import { verifyBackupPayload } from "../../../scripts/lib/backup-common.mjs";
import { apiCopy } from "@/lib/i18n/api-copy";
import { resolveLocalTarBinary } from "@/lib/runtime/tar-binary";
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
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import {
  access,
  open,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  rename,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { SessionPayload } from "@/lib/auth/session";
import { isGlobalTeamManager, teamWhere } from "@/lib/auth/team-scope";
import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { BusinessError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { createLogger } from "@/lib/logging";
import { isPlatformAdmin } from "@/lib/system/platform-admin";
import { sha256File } from "@/lib/crypto/sha256-file";

import { t } from "@/lib/i18n/service-translations";
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

const manifestSchema = z.object({
  version: z.literal(MIGRATION_MANIFEST_VERSION),
  packageId: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  source: z.object({
    app: z.literal("VControlHub"), hostname: z.string().trim().min(1), recordId: z.string().trim().min(1),
    teamId: z.string().min(1).nullable(),
  }),
  backup: z.object({
    type: z.enum(["DATABASE", "FILES", "FULL"]), originalFilePath: z.string().min(1), payloadFileName: z.string().min(1),
    fileSize: z.number().int().positive(), checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    note: z.string().nullable(), completedAt: z.iso.datetime({ offset: true }).nullable(),
  }),
  instructions: z.object({ import: z.string(), restore: z.string() }),
});
export type MigrationManifest = z.infer<typeof manifestSchema>;

export type MigrationExportResult = {
  packageId: string;
  packageRelativeDir: string;
  manifestRelativePath: string;
  payloadRelativePath: string;
  absoluteDir: string;
  tarballRelativePath: string | null;
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

type MigrationSession = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

function projectRoot(): string {
  return config.app.appDir || process.cwd();
}

async function copyPrivateArtifact(source: string, destination: string) {
  const handle = await open(destination, "wx", 0o600);
  try {
    await pipeline(createReadStream(source), handle.createWriteStream());
  } catch (error) {
    await handle.close();
    await rm(destination, { force: true });
    throw error;
  } finally {
    await handle.close();
  }
}

function packagesRoot(root = projectRoot()): string {
  return join(getBackupStorageRoot(root), MIGRATION_PACKAGE_DIR);
}

/** Compare every existing path component with its real path, including the backup root. */
async function assertRealPath(file: string) {
  const absolute = resolve(file);
  if (await realpath(absolute) === absolute) return;
  // Windows also expands short 8.3 names in realpath. Inspect the components
  // to distinguish an ordinary alias from a junction or symbolic link.
  for (let part = absolute; part !== dirname(part); part = dirname(part)) {
    if ((await lstat(part)).isSymbolicLink()) throw new ValidationError(t("backend.backup.packageOutsideRoot"));
  }
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

  if (!isAbsolute(ref)) {
    // portable relative under backup root
    const portable = assertPortableBackupPath(ref.replace(/^\.?\//, ""));
    candidate = join(storageRoot, portable);
  }

  // must stay under storage root (path-boundary, not naive string prefix)
  const resolvedRoot = resolve(storageRoot);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (isAbsolute(rel) || rel.startsWith("..") || resolve(resolvedRoot, rel) !== resolvedCandidate) {
    throw new ValidationError(t("backend.backup.packageOutsideRoot"));
  }
  candidate = resolvedCandidate;

  const info = await lstat(candidate).catch(() => null);
  if (!info) throw new NotFoundError(t("backend.backup.packagePathNotFound"));

  await assertRealPath(resolvedRoot);
  await assertRealPath(candidate);
  if (info.isDirectory()) {
    return { packageDir: candidate };
  }

  // file: only accept .tar.gz under storage root — extract to temp under packages root
  if (!info.isFile() || (!candidate.endsWith(".tar.gz") && !candidate.endsWith(".tgz"))) {
    throw new ValidationError(t("backend.backup.packageMustBeDirOrTgz"));
  }

  const parent = packagesRoot(root);
  await mkdir(parent, { recursive: true });
  await assertRealPath(parent);
  const extractDir = await mkdtemp(join(parent, "import-"));
  try {
    const [{ stdout: memberNames }, { stdout: memberDetails }] = await Promise.all([
      runFile(
      resolveLocalTarBinary(), ["-tzf", candidate], {
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
      }),
      runFile(
      resolveLocalTarBinary(), ["-tvzf", candidate], {
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
      }),
    ]);
    for (const member of memberNames.split("\n").filter(Boolean)) {
      const parts = member.replace(/\\/g, "/").split("/");
      if (member.startsWith("/") || parts.some((part) => part === "..")) {
        throw new ValidationError(t("backend.backup.archiveMemberUnsafe", { member }));
      }
    }
    for (const detail of memberDetails.split("\n").filter(Boolean)) {
      const type = detail[0];
      if (type !== "-" && type !== "d") {
        throw new ValidationError(t("backend.backup.archiveRegularOnly"));
      }
    }

    // Prefer GNU tar --restrict when available; always re-verify no path escape after extract.
    await runFile(
      resolveLocalTarBinary(), ["-xzf", candidate, "-C", extractDir, "--restrict"], {
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
    }).catch(async () => {
      // BusyBox/older tar may not support --restrict; fall back then verify members.
      await rm(extractDir, { recursive: true, force: true });
      await mkdir(extractDir, { recursive: true, mode: 0o700 });
      await runFile(
      resolveLocalTarBinary(), ["-xzf", candidate, "-C", extractDir, "--no-same-owner", "--no-same-permissions"], {
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
      });
    });
  } catch (error) {
    await rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
    throw new BusinessError(
      t("backend.backup.extractMigrationPackageFailed", {
        error: error instanceof Error ? error.message : String(error),
      }),
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
      if (kid.isSymbolicLink() || (!kid.isDirectory() && !kid.isFile())) {
        throw new ValidationError(t("backend.backup.archiveRegularOnly"));
      }
      if (kid.isDirectory()) await assertNoEscape(abs, rootAbs);
    }
  }
  try {
    await assertNoEscape(extractDir, resolve(extractDir));
    const entries = await readdir(extractDir);
    const only = entries.length === 1 ? join(extractDir, entries[0]!) : null;
    const packageDir = only && (await stat(only)).isDirectory() ? only : extractDir;
    return { packageDir, cleanup: () => rm(extractDir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(extractDir, { recursive: true, force: true });
    throw error;
  }
}

export async function readMigrationManifest(packageDir: string): Promise<MigrationManifest> {
  const manifestPath = join(packageDir, "manifest.json");
  let raw: string;
  try {
    await assertRealPath(manifestPath);
    if (!(await lstat(manifestPath)).isFile()) throw new Error();
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
  const result = manifestSchema.safeParse(parsed);
  if (!result.success) throw new ValidationError(t("backend.backup.manifestMissingFields"));
  const m = result.data;
  assertSafePackageId(m.packageId);
  if (
    basename(m.backup.payloadFileName) !== m.backup.payloadFileName ||
    m.backup.payloadFileName === "." ||
    m.backup.payloadFileName === ".." ||
    m.backup.payloadFileName.includes("\\") ||
    m.backup.payloadFileName.includes("\0")
  ) {
    throw new ValidationError(t("backend.backup.payloadNameInvalid"));
  }
  return m;
}

function assertMigrationTeamAccess(
  manifest: MigrationManifest,
  session?: MigrationSession | null,
) {
  // A platform admin may open any package; everyone else is held to the
  // team stamp. Go through the shared helper so the definition of "platform
  // admin" stays in one place (it must never be a direct permission grant).
  if (!session || isPlatformAdmin(session)) return;
  const sourceTeamId = manifest.source?.teamId ?? null;
  // Legacy null-team packages follow the existing shared backup policy. A
  // stamped package is visible only from the matching current team.
  if (sourceTeamId !== null && sourceTeamId !== session.currentTeamId) {
    throw new ForbiddenError(t("backend.backup.packageTeamForbidden"));
  }
}

export async function validateMigrationPackage(
  packageRef: string,
  root = projectRoot(),
  session?: MigrationSession | null,
): Promise<MigrationValidateResult & { cleanup?: () => Promise<void> }> {
  const resolved = await resolveMigrationPackageDir(packageRef, root);
  try {
    const issues: string[] = [];
    const manifest = await readMigrationManifest(resolved.packageDir);
    assertMigrationTeamAccess(manifest, session);
    const payloadAbsolutePath = resolve(resolved.packageDir, manifest.backup.payloadFileName);
    const payloadRelativePath = relative(resolve(resolved.packageDir), payloadAbsolutePath);
    if (
      payloadRelativePath.startsWith("..") ||
      payloadRelativePath === ".." ||
      resolve(resolved.packageDir, payloadRelativePath) !== payloadAbsolutePath
    ) {
      throw new ValidationError(t("backend.backup.packageOutsideRoot"));
    }
    try {
      const payloadInfo = await lstat(payloadAbsolutePath);
      if (payloadInfo.isFile()) await assertRealPath(payloadAbsolutePath);
      if (!payloadInfo.isFile()) {
        issues.push(`payload is not a regular file: ${manifest.backup.payloadFileName}`);
      }
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

    if (!issues.length) {
      try {
        await verifyBackupPayload(manifest.backup.type, payloadAbsolutePath);
      } catch (error) {
        issues.push(error instanceof Error ? error.message : String(error));
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
  } catch (error) {
    await resolved.cleanup?.();
    throw error;
  }
}

export async function exportMigrationPackage(input: {
  backupId: string;
  session?: MigrationSession;
  projectRoot?: string;
  note?: string;
}): Promise<MigrationExportResult> {
  const root = input.projectRoot || projectRoot();
  const record = input.session && !isGlobalTeamManager(input.session)
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

  await assertRealPath(sourcePath);
  if (!sourceInfo.size) throw new BusinessError(t("backend.backup.artifactEmpty"));

  const packageId = `mig-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const packageRelativeDir = `${MIGRATION_PACKAGE_DIR}/${packageId}`;
  const absoluteDir = join(getBackupStorageRoot(root), packageRelativeDir);
  const payloadFileName = `payload.${record.type === "DATABASE" ? "sql.gz" : "tar.gz"}`;
  await mkdir(dirname(absoluteDir), { recursive: true });
  await assertRealPath(dirname(absoluteDir));
  const staging = await mkdtemp(join(dirname(absoluteDir), ".export-"));
  let manifest: MigrationManifest;
  try {
    const payload = join(staging, payloadFileName);
    await copyPrivateArtifact(sourcePath, payload);
    const checksum = await sha256File(payload);
    if (record.checksumSha256 && checksum !== record.checksumSha256.toLowerCase()) {
      throw new BusinessError(t("backend.backup.checksumMismatch"));
    }
    const payloadSize = (await stat(payload)).size;
    manifest = {
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
        fileSize: payloadSize,
        checksumSha256: checksum,
        note: input.note?.trim() || record.note || null,
        completedAt: record.completedAt?.toISOString() ?? null,
      },
      instructions: {
        import:
          "On the target VControlHub host: place this package under BACKUP_DIR/migration-packages/ (or upload), then use Migration Wizard → Import & Register. Validation checks sha256 before creating a COMPLETED BackupRecord.",
        restore:
          "After import, run a restore drill first (non-destructive). Restore is offline: Restore on the imported record verifies its checksum and gives the runbook — stop the platform services, take the safety snapshot, run the restore command, start the services.",
      },
    };
    await verifyBackupPayload(record.type, payload);
    await writeFile(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await rename(staging, absoluteDir);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }

  // Optional convenience tarball next to the directory
  const tarRelative = `${packageRelativeDir}.tar.gz`;
  const tarAbsolute = join(getBackupStorageRoot(root), tarRelative);
  let tarballRelativePath: string | null = null;
  let privateDir: string | undefined;
  try {
    privateDir = await mkdtemp(join(dirname(tarAbsolute), ".archive-"));
    const tarTemporary = join(privateDir, "package.tar.gz");
    await writeFile(tarTemporary, "", { flag: "wx", mode: 0o600 });
    await runFile(
      resolveLocalTarBinary(),
      ["-czf", tarTemporary, "-C", dirname(absoluteDir), basename(absoluteDir)],
      { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 },
    );
    await chmod(tarTemporary, 0o600);
    await rename(tarTemporary, tarAbsolute);
    tarballRelativePath = tarRelative;
  } catch (error) {
    // A tar stopped by the time limit (or a full disk) leaves the beginning of
    // an archive behind. Listed as the package's tarball, it was what an
    // operator copied to the other host, where it failed to extract.
    logger.warn("migration package tarball creation failed (directory package still valid)", {
      packageId,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (privateDir) await rm(privateDir, { recursive: true, force: true });
  }

  logger.info("migration package exported", {
    packageId,
    backupId: record.id,
    type: record.type,
    size: manifest.backup.fileSize,
  });

  return {
    packageId,
    packageRelativeDir,
    manifestRelativePath: `${packageRelativeDir}/manifest.json`,
    payloadRelativePath: `${packageRelativeDir}/${payloadFileName}`,
    absoluteDir,
    tarballRelativePath,
    manifest,
  };
}

export async function importMigrationPackage(input: {
  packageRef: string;
  session?: MigrationSession;
  projectRoot?: string;
  note?: string;
}): Promise<MigrationImportResult> {
  const root = input.projectRoot || projectRoot();
  const validated = await validateMigrationPackage(input.packageRef, root, input.session);
  try {
    if (!validated.ok) {
      throw new ValidationError(
        apiCopy("apiCopy.migration.package.validation.failed.d3ca05a5", { v0: String(validated.issues.join("; ")) }),
      );
    }

    const { manifest, payloadAbsolutePath } = validated;
    const type = manifest.backup.type;
    // Exclusive copy: two imports stamped in the same millisecond used to
    // share one path, and the second silently overwrote the first backup
    // while both records said COMPLETED. A taken name gets a random suffix.
    let portablePath = buildBackupFilePath(type);
    let destAbsolute = "";
    for (let attempt = 0; ; attempt += 1) {
      assertPortableBackupPath(portablePath);
      destAbsolute = resolveBackupPath(root, portablePath);
      await mkdir(dirname(destAbsolute), { recursive: true });
      await assertRealPath(dirname(destAbsolute));
      try {
        await copyPrivateArtifact(payloadAbsolutePath, destAbsolute);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt >= 3) throw error;
        portablePath = buildBackupFilePath(type).replace(/(\.(?:sql|tar)\.gz)$/, `-${randomUUID().slice(0, 8)}$1`);
      }
    }

    // The copy belongs to this import until a record names it: any failure
    // before that (a mismatch, or the record write itself) removes it, or a
    // retry left an unlisted full copy behind and made another.
    let fileInfo: Awaited<ReturnType<typeof stat>>;
    let checksum: string;
    let record: Awaited<ReturnType<typeof prisma.backupRecord.create>>;
    try {
      fileInfo = await stat(destAbsolute);
      checksum = await sha256File(destAbsolute);
      if (checksum.toLowerCase() !== manifest.backup.checksumSha256.toLowerCase()) {
        throw new BusinessError(t("backend.backup.importChecksumMismatch"));
      }

      const noteParts = [
        `Imported migration package ${manifest.packageId}`,
        `sourceHost=${manifest.source.hostname}`,
        `sourceRecord=${manifest.source.recordId}`,
        input.note?.trim() || "",
        manifest.backup.note || "",
      ].filter(Boolean);

      record = await prisma.backupRecord.create({
        data: {
          type,
          status: "COMPLETED",
          filePath: portablePath,
          fileSize: String(fileInfo.size),
          checksumSha256: checksum,
          note: noteParts.join(" | ").slice(0, 1000),
          completedAt: new Date(),
          createdBy: input.session?.userId ?? null,
          teamId: null,
        },
      });
    } catch (error) {
      await rm(destAbsolute, { force: true }).catch(() => undefined);
      throw error;
    }

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
  await assertRealPath(rootDir);
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
  const filterByTeam = Boolean(session && !isAdmin);

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const packageId = assertSafePackageId(entry.name);
      const relativeDir = `${MIGRATION_PACKAGE_DIR}/${packageId}`;
      const dir = join(rootDir, packageId);
      const manifest = await readMigrationManifest(dir).catch(() => null);
      if (!manifest) continue;
      const sourceTeamId = manifest.source.teamId;
      // Team-scoped list: include this team's packages and legacy unscoped packages.
      if (filterByTeam && sourceTeamId !== null && sourceTeamId !== teamId) {
        continue;
      }
      const tarPath = join(getBackupStorageRoot(root), `${relativeDir}.tar.gz`);
      const hasTarball = await lstat(tarPath)
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
