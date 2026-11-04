import { NextResponse } from "next/server";

import { AUDIT_EXPORT_MAX_ROWS, exportAuditLogs, iterateAuditLogsForExport, type AuditLogEntry } from "@/lib/audit/service";
import { formatAuditDetail } from "@/lib/audit/detail-format";
import { withApiRoute } from "@/lib/http/api-guard";
import { csvCell } from "@/lib/http/csv";
import { GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";
import { z } from "zod";
import { t } from "@/lib/i18n/service-translations";

export const dynamic = "force-dynamic";

const exportQuerySchema = z.object({
  format: z.enum(["csv", "json"]).default("csv"),
  action: z.string().trim().min(1).optional(),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]).optional(),
  search: z.string().trim().min(1).optional(),
});

function csvHeader(): string {
  return [
    t("backend.audit.export.timestamp"),
    t("backend.audit.export.action"),
    t("backend.audit.export.severity"),
    t("backend.audit.export.actor"),
    t("backend.audit.export.actorType"),
    t("backend.audit.export.details"),
  ].map(csvCell).join(",");
}

function csvRows(logs: AuditLogEntry[]): string[] {
  return logs.map((log) =>
    [
      new Date(log.createdAt).toISOString(),
      log.action,
      log.severity,
      log.actor ? (log.actor.displayName ?? log.actor.username) : "",
      log.actorType,
      formatAuditDetail(log.detail, "; "),
    ]
      .map(csvCell)
      .join(","),
  );
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
    const filter = {
      action: params.action,
      severity: params.severity,
      search: params.search,
      session,
    };

    if (params.format === "json") {
      return NextResponse.json(await exportAuditLogs(filter));
    }

    // Streamed in batches (A8-05); the last line says so when the cap cut the export short.
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          // The byte-order mark makes Excel (Windows) read the UTF-8 text as UTF-8 instead of the system code page.
          controller.enqueue(encoder.encode(`\ufeff${csvHeader()}`));
          let count = 0;
          for await (const batch of iterateAuditLogsForExport(filter)) {
            count += batch.length;
            controller.enqueue(encoder.encode(`\n${csvRows(batch).join("\n")}`));
          }
          if (count >= AUDIT_EXPORT_MAX_ROWS) {
            controller.enqueue(encoder.encode(`\n${csvCell(t("backend.audit.export.truncated", { max: AUDIT_EXPORT_MAX_ROWS }))}`));
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  });
}
