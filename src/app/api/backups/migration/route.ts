/**
 * POST /api/backups/migration
 *
 * Wizard actions for cross-environment backup migration:
 *  - export:   COMPLETED backup → self-describing package (manifest + payload)
 *  - validate: check package integrity (sha256 / size / manifest)
 *  - import:   validate + register as COMPLETED BackupRecord (no auto-restore)
 *  - list:     list packages under BACKUP_DIR/migration-packages
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  exportMigrationPackage,
  importMigrationPackage,
  listMigrationPackages,
  validateMigrationPackage,
} from "@/lib/backup/migration-package";
import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("export"),
    backupId: z.string().trim().min(1),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal("validate"),
    packageRef: z.string().trim().min(1).max(500),
  }),
  z.object({
    action: z.literal("import"),
    packageRef: z.string().trim().min(1).max(500),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal("list"),
  }),
]);

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      // Export/import create durable artifacts — require create; list/validate also gated.
      permission: "backup:create",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema,
      errorMessage: "Migration wizard action failed",
    },
    async ({ session, body }) => {
      if (body.action === "list") {
        const packages = await listMigrationPackages();
        return NextResponse.json({ packages });
      }

      if (body.action === "export") {
        const result = await exportMigrationPackage({
          backupId: body.backupId,
          session: session!,
          note: body.note,
        });
        await auditUserAction(session!.userId, "backup.migration.export", {
          backupId: body.backupId,
          packageId: result.packageId,
          type: result.manifest.backup.type,
        });
        return NextResponse.json({
          success: true,
          packageId: result.packageId,
          packageRelativeDir: result.packageRelativeDir,
          manifestRelativePath: result.manifestRelativePath,
          payloadRelativePath: result.payloadRelativePath,
          tarballRelativePath: `${result.packageRelativeDir}.tar.gz`,
          manifest: result.manifest,
        });
      }

      if (body.action === "validate") {
        const result = await validateMigrationPackage(body.packageRef);
        if (result.cleanup) await result.cleanup();
        return NextResponse.json({
          success: result.ok,
          ok: result.ok,
          packageId: result.manifest.packageId,
          type: result.manifest.backup.type,
          fileSize: result.manifest.backup.fileSize,
          checksumMatches: result.checksumMatches,
          sizeMatches: result.sizeMatches,
          issues: result.issues,
          manifest: result.manifest,
        });
      }

      // import
      const imported = await importMigrationPackage({
        packageRef: body.packageRef,
        session: session!,
        note: body.note,
      });
      await auditUserAction(session!.userId, "backup.migration.import", {
        packageId: imported.packageId,
        backupId: imported.backupId,
        type: imported.type,
        fileSize: imported.fileSize,
      });
      return NextResponse.json({
        success: true,
        backupId: imported.backupId,
        filePath: imported.filePath,
        type: imported.type,
        checksumSha256: imported.checksumSha256,
        fileSize: imported.fileSize,
        packageId: imported.packageId,
      });
    },
  );
}

export async function GET(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "backup:read",
      rateLimit: GENERAL_READ_LIMIT,
      errorMessage: "Failed to list migration packages",
    },
    async () => {
      const packages = await listMigrationPackages();
      return NextResponse.json({ packages });
    },
  );
}
