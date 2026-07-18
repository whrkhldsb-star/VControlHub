/**
 * TR-042: 系统配置导入 API
 * POST /api/system/import → 预览或执行导入
 *
 * Body: { file: ExportFile, options: ImportOptions }
 * Returns: { preview: ImportPreview } (dryRun) | { result: ImportResult }
 */

import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { auditUserAction } from "@/lib/audit/service";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { exportFileSchema, importOptionsSchema } from "@/lib/system/config-schema";
import { previewImport, executeImport } from "@/lib/system/import-service";

export const dynamic = "force-dynamic";

const importBodySchema = importOptionsSchema.extend({
  file: exportFileSchema,
});

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "user:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: importBodySchema,
    },
    async ({ session, body }) => {
      const { file, ...options } = body;

      if (options.dryRun) {
        // 预览模式：不写入
        const preview = await previewImport(file, options);
        await auditUserAction(session?.userId ?? "", "system.import.preview", {
          totalRecords: preview.totalRecords,
          schemaVersion: file.schemaVersion,
        }, undefined, session?.currentTeamId);
        return NextResponse.json({ preview });
      }

      // 实际导入
      const result = await executeImport(file, options);
      await auditUserAction(session?.userId ?? "", "system.import", {
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors,
        sourceDomain: file.sourceDomain,
      }, undefined, session?.currentTeamId);

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