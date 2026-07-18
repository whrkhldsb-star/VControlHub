import { NextResponse } from "next/server";

import { exportAuditLogs, type AuditLogEntry } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { z } from "zod";

export const dynamic = "force-dynamic";

const exportQuerySchema = z.object({
  format: z.enum(["csv", "json"]).default("csv"),
  action: z.string().trim().min(1).optional(),
  severity: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
});

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

function toCsv(logs: AuditLogEntry[]): string {
  const header = ["Timestamp", "Action", "Severity", "Actor", "Actor Type", "Details"].map(csvEscape).join(",");
  const rows = logs.map((log) =>
    [
      new Date(log.createdAt).toISOString(),
      log.action,
      log.severity,
      log.actor ? (log.actor.displayName ?? log.actor.username) : "",
      log.actorType,
      Object.entries(log.detail)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join("; "),
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header, ...rows].join("\n");
}

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "audit:read", rateLimit: GENERAL_WRITE_LIMIT },
    async ({ session }) => {
    const url = new URL(request.url);
    const params = exportQuerySchema.parse(Object.fromEntries(url.searchParams));
    const logs = await exportAuditLogs({
      action: params.action,
      severity: params.severity,
      search: params.search,
      session,
    });

    if (params.format === "json") {
      return NextResponse.json(logs);
    }

    const csv = toCsv(logs);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  });
}
