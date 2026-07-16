/**
 * GET  /api/alert-incidents — list open/ack/resolved incidents
 * POST /api/alert-incidents — acknowledge an incident { incidentId }
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  acknowledgeAlertIncident,
  listAlertIncidents,
} from "@/lib/alert/incidents";
import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { parseSearchParams } from "@/lib/http/parse-search-params";

const listQuerySchema = z.object({
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]).optional(),
});

const ackSchema = z.object({
  incidentId: z.string().trim().min(1),
});

export async function GET(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "notification:manage",
      rateLimit: GENERAL_READ_LIMIT,
      errorMessage: "Failed to list alert incidents",
    },
    async () => {
      const { status } = parseSearchParams(request, listQuerySchema);
      const incidents = await listAlertIncidents({ status });
      return NextResponse.json({
        incidents: incidents.map((i) => ({
          id: i.id,
          fingerprint: i.fingerprint,
          ruleId: i.ruleId,
          ruleName: i.rule?.name ?? null,
          serverId: i.serverId,
          serverName: i.serverName,
          metric: i.metric,
          operator: i.operator,
          threshold: i.threshold,
          value: i.value,
          status: i.status,
          level: i.level,
          title: i.title,
          message: i.message,
          acknowledgedAt: i.acknowledgedAt?.toISOString() ?? null,
          acknowledgedBy: i.acknowledgedBy
            ? {
                id: i.acknowledgedBy.id,
                username: i.acknowledgedBy.username,
                displayName: i.acknowledgedBy.displayName,
              }
            : null,
          escalatedAt: i.escalatedAt?.toISOString() ?? null,
          lastNotifiedAt: i.lastNotifiedAt?.toISOString() ?? null,
          resolvedAt: i.resolvedAt?.toISOString() ?? null,
          createdAt: i.createdAt.toISOString(),
          escalationMinutes: i.rule?.escalationMinutes ?? 30,
          onCallUserIds: i.rule?.onCallUserIds ?? [],
        })),
      });
    },
  );
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "notification:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: ackSchema,
      errorMessage: "Failed to acknowledge alert incident",
    },
    async ({ session, body }) => {
      const result = await acknowledgeAlertIncident({
        incidentId: body.incidentId,
        userId: session!.userId,
      });
      await auditUserAction(session!.userId, "alert_incident.acknowledge", {
        incidentId: result.id,
        status: result.status,
      });
      return NextResponse.json({ success: true, incident: result });
    },
  );
}
