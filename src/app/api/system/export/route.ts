/**
 * TR-042: 系统配置导出 API
 * GET /api/system/export → 下载 .vch.json
 *
 * Query:
 * - mode=standard|full  (full requires platform admin)
 * - scope=team|global   (default team; global requires platform admin)
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { auditUserAction } from "@/lib/audit/service";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import {
  buildExportFile,
  getExportSummary,
  type ExportMode,
  type ExportScope,
} from "@/lib/system/export-service";
import { ForbiddenError, ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "user:manage", rateLimit: GENERAL_WRITE_LIMIT },
    async ({ session }) => {
      if (!session) {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
      }

      const url = new URL(request.url);
      const sourceDomain = url.host || "unknown";
      const mode = (url.searchParams.get("mode") === "full" ? "full" : "standard") as ExportMode;
      const scopeParam = url.searchParams.get("scope");
      const scope = (scopeParam === "global" ? "global" : "team") as ExportScope;

      try {
        const file = await buildExportFile({
          sourceDomain,
          mode,
          scope,
          teamId: session.currentTeamId,
          session,
        });
        const summary = getExportSummary(file);

        await auditUserAction(
          session.userId,
          "system.export",
          {
            sourceDomain,
            exportMode: file.exportMode ?? mode,
            exportScope: file.exportScope ?? scope,
            exportTeamId: file.exportTeamId ?? null,
            recordCounts: summary,
          },
          undefined,
          session.currentTeamId,
        );

        const json = JSON.stringify(file, null, 2);
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        const scopeTag = file.exportScope === "global" ? "global" : "team";
        const filename = `vch-config-${scopeTag}-${timestamp}.json`;

        return new NextResponse(json, {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
          },
        });
      } catch (error) {
        if (error instanceof ForbiddenError) {
          return NextResponse.json({ error: error.message }, { status: 403 });
        }
        if (error instanceof ValidationError) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
        throw error;
      }
    },
  );
}
