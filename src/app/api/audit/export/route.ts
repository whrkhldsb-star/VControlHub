import { AUDIT_EXPORT_MAX_ROWS, prepareAuditExport, type AuditLogEntry } from "@/lib/audit/service";
import { formatAuditDetail } from "@/lib/audit/detail-format";
import { withApiRoute } from "@/lib/http/api-guard";
import { csvCell } from "@/lib/http/csv";
import { GENERAL_READ_LIMIT, rateLimitResponse } from "@/lib/http/rate-limit-presets";
import { z } from "zod";
import { t } from "@/lib/i18n/service-translations";

export const dynamic = "force-dynamic";

const MAX_CONCURRENT_EXPORTS_GLOBAL = 4;
const MAX_CONCURRENT_EXPORTS_PER_USER = 2;
let activeExportsGlobal = 0;
const activeExportsByUser = new Map<string, number>();

function acquireAuditExportSlot(userId: string): (() => void) | null {
  const userCount = activeExportsByUser.get(userId) ?? 0;
  if (activeExportsGlobal >= MAX_CONCURRENT_EXPORTS_GLOBAL || userCount >= MAX_CONCURRENT_EXPORTS_PER_USER) {
    return null;
  }
  activeExportsGlobal += 1;
  activeExportsByUser.set(userId, userCount + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeExportsGlobal = Math.max(0, activeExportsGlobal - 1);
    const next = (activeExportsByUser.get(userId) ?? 1) - 1;
    if (next <= 0) activeExportsByUser.delete(userId);
    else activeExportsByUser.set(userId, next);
  };
}

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
      request.signal.throwIfAborted();
      const slot = acquireAuditExportSlot(session.userId);
      if (!slot) return rateLimitResponse(5_000);
      const releaseSlot = slot;
      let batches: Awaited<ReturnType<typeof prepareAuditExport>>["batches"];
      let truncated: boolean;
      try {
        ({ batches, truncated } = await prepareAuditExport({
          action: params.action, severity: params.severity, search: params.search, session,
        }, request.signal));
      } catch (error) {
        releaseSlot();
        throw error;
      }
      const json = params.format === "json";
      const encoder = new TextEncoder();
      const prefix = json ? "[" : `\ufeff${csvHeader()}`;
      const suffix = json ? "]" : truncated ? `\n${csvCell(t("backend.audit.export.truncated", { max: AUDIT_EXPORT_MAX_ROWS }))}` : "";
      let firstBatch = true;
      let stopped = false;
      let onAbort: () => void;
      function finish() {
        stopped = true;
        request.signal.removeEventListener("abort", onAbort);
        releaseSlot();
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          onAbort = () => {
            finish();
            controller.error(request.signal.reason);
            void batches.return(undefined).catch(() => undefined);
          };
          if (request.signal.aborted) return onAbort();
          request.signal.addEventListener("abort", onAbort, { once: true });
          controller.enqueue(encoder.encode(prefix));
        },
        async pull(controller) {
          try {
            const next = await batches.next();
            if (stopped) return;
            if (next.done) {
              finish();
              if (suffix) controller.enqueue(encoder.encode(suffix));
              controller.close();
              return;
            }
            const chunk = json
              ? (firstBatch ? "" : ",") + next.value.map((log) => JSON.stringify(log)).join(",")
              : "\n" + csvRows(next.value).join("\n");
            firstBatch = false;
            controller.enqueue(encoder.encode(chunk));
          } catch (error) {
            finish();
            throw error;
          }
        },
        async cancel() {
          finish();
          await batches.return(undefined);
        },
      }, { highWaterMark: 0 });
      return new Response(stream, {
        headers: json
          ? { "Content-Type": "application/json", "X-Audit-Export-Truncated": String(truncated) }
          : { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="audit-export-${new Date().toISOString().slice(0, 10)}.csv"` },
      });
    },
  );
}
