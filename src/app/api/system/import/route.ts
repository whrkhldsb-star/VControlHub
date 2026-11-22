/**
 * TR-042: 系统配置导入 API
 * POST /api/system/import → 预览或执行导入
 *
 * Body: { file: ExportFile, options: ImportOptions }
 * Returns: { preview: ImportPreview } (dryRun) | { result: ImportResult }
 */

import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { ValidationError } from "@/lib/errors";
import { auditUserAction } from "@/lib/audit/service";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { CONFIG_IMPORT_MAX_BODY_BYTES, exportFileSchema, importOptionsSchema } from "@/lib/system/config-schema";
import { previewImport, executeImport } from "@/lib/system/import-service";
import { assertPlatformAdminForConfigImport } from "@/lib/system/platform-admin";

export const dynamic = "force-dynamic";

const importBodySchema = importOptionsSchema.extend({
  file: exportFileSchema,
});

const failureCodes = new Set(["validation", "transaction", ...Object.keys(exportFileSchema.shape.tables.shape)]
  .map((stage) => "IMPORT_FAILED." + stage));

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "user:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: importBodySchema,
      maxBodyBytes: CONFIG_IMPORT_MAX_BODY_BYTES,
    },
    async ({ session, body }) => {
      // `user:manage` opens the settings tab, but an import writes the global
      // RBAC catalog and trusts each row's teamId — that needs the platform
      // admin role, matching the bar the export side already enforces.
      assertPlatformAdminForConfigImport(session);
      const { file, ...options } = body;

      if (options.dryRun) {
        // 预览模式：不写入
        const preview = await previewImport(file, options).catch(() => { throw new ValidationError("IMPORT_PREVIEW_FAILED"); });
        await auditUserAction(session.userId, "system.import.preview", {
          totalRecords: preview.totalRecords,
          schemaVersion: file.schemaVersion,
        }, undefined, null);
        return NextResponse.json({ preview });
      }

      // 实际导入
      const outcome = await executeImport(file, options).catch(() => { throw new ValidationError("IMPORT_FAILED"); });
      const result = { ...outcome, errors: outcome.errors.map((code) => failureCodes.has(code) ? code : "IMPORT_FAILED.transaction") };
      await auditUserAction(session.userId, "system.import", {
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errorCount: result.errors.length,
      }, undefined, null);

      if (result.rolledBack) {
        return NextResponse.json(
          { result, error: "IMPORT_ROLLED_BACK" },
          { status: 400 },
        );
      }
      if (result.errors.length > 0) {
        return NextResponse.json(
          { result, error: "IMPORT_PARTIAL_FAILURE" },
          { status: 207 },
        );
      }

      return NextResponse.json({ result });
    },
  );
}
