import { NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { getShareAccessReport } from "@/lib/share-link/service";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
  action: z.enum(["all", "view", "download", "password_attempt"]).optional(),
  format: z.enum(["json", "csv"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "share:manage", errorMessage: "Failed to load share access report" }, async ({ session }) => {
    const query = parseSearchParams(request, querySchema);
    const report = await getShareAccessReport({ session: session!, days: query.days, action: query.action, take: query.limit });
    if (query.format === "csv") {
      const header = ["accessedAt", "action", "shareId", "shareName", "path", "permissionLevel", "ip", "userAgent"];
      const rows = report.logs.map((log) => [log.accessedAt, log.action, log.share.id, log.share.name || log.share.path, log.share.path, log.share.permissionLevel, log.ip, log.userAgent]);
      const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
      await auditUserAction(session!.userId, "share.access-report.export", { days: report.range.days, action: report.range.action, rows: report.logs.length });
      return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="share-access-report.csv"', "cache-control": "no-store" } });
    }
    return NextResponse.json({ report });
  });
}
