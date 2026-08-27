import { NextResponse } from "next/server";

import { exportAuditLogs, type AuditLogEntry } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { csvCell } from "@/lib/http/csv";
import { GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";
import { z } from "zod";
import { t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

const exportQuerySchema = z.object({
  format: z.enum(["csv", "json"]).default("csv"),
  action: z.string().trim().min(1).optional(),
  severity: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
});

function toCsv(logs: AuditLogEntry[]): string {
  const header = [
    t("backend.audit.export.timestamp"),
    t("backend.audit.export.action"),
    t("backend.audit.export.severity"),
    t("backend.audit.export.actor"),
    t("backend.audit.export.actorType"),
    t("backend.audit.export.details"),
  ].map(csvCell).join(",");
  const rows = logs.map((log) =>
    [
      new Date(log.createdAt).toISOString(),
      log.action,
      log.severity,
      log.actor ? (log.actor.displayName ?? log.actor.username) : "",
      log.actorType,
      Object.entries(log.detail)
        // `String(v)` renders a nested object as "[object Object]", and audit
        // details routinely nest (metric readings, playbook step lists, zod
        // issues). Serialise those instead so the export keeps the data.
        .map(([k, v]) => `${k}=${typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}`)
        .join("; "),
    ]
      .map(csvCell)
      .join(","),
  );
  return [header, ...rows].join("\n");
}

export async function GET(request: Request) {
  return withApiRoute(
    request,
    // The query goes through the guard's `querySchema` rather than a bare
    // `.parse()` in the handler: a thrown ZodError is not an AppError, so
    // `apiCatch` would turn `?format=xml` into a 500 "Operation failed"
    // instead of a 400 naming the bad field.
    {
      permission: "audit:read",
      rateLimit: GENERAL_READ_LIMIT,
      querySchema: exportQuerySchema,
    },
    async ({ session, query: params }) => {
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
