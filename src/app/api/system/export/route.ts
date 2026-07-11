/**
 * TR-042: 系统配置导出 API
 * GET /api/system/export → 下载 .vch.json
 */

import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { auditUserAction } from "@/lib/audit/service";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { buildExportFile, getExportSummary, type ExportMode } from "@/lib/system/export-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "user:manage", rateLimit: GENERAL_WRITE_LIMIT },
    async ({ session }) => {
    const url = new URL(request.url);
    const sourceDomain = url.host || "unknown";
    const mode = (url.searchParams.get("mode") === "full" ? "full" : "standard") as ExportMode;
    const file = await buildExportFile(sourceDomain, mode);
    const summary = getExportSummary(file);

    await auditUserAction(session?.userId ?? "", "system.export", {
      sourceDomain,
      exportMode: mode,
      recordCounts: summary,
    });

    const json = JSON.stringify(file, null, 2);
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `vch-config-${timestamp}.json`;

    return new NextResponse(json, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  });
}