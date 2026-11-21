import { sessionHasPermission } from "@/lib/auth/authorization";
import { serverTeamWhere, type TeamSession } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";

function record(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
}

function scalarFields(context: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.flatMap((key) => {
    const value = context[key];
    return typeof value === "string" || typeof value === "number" ? [[key, value]] : [];
  }));
}

function projectContext(context: Record<string, unknown> | undefined, visible: Set<string>) {
  if (!context) return null;
  const hostVisible = typeof context.serverId === "string" && visible.has(context.serverId);
  if (context.type === "alert_rule" || context.type === "capacity_forecast") {
    return hostVisible ? scalarFields(context, ["type", "alertRuleId", "alertRuleName", "serverId", "serverName",
      "metric", "operator", "threshold", "value", "triggeredAt", "incidentId"]) : null;
  }
  if (context.type === "metric") {
    const readings = Array.isArray(context.readings) ? context.readings : [];
    return {
      ...scalarFields(context, ["type", "metric", "operator", "threshold", "sampledAt"]),
      readings: readings.flatMap((item) => {
        const reading = record(item);
        return typeof reading?.serverId === "string" && visible.has(reading.serverId)
          ? [scalarFields(reading, ["serverId", "value", "sampleAt"])] : [];
      }),
    };
  }
  if (context.type === "cron") return scalarFields(context, ["type", "expression", "scheduledFor", "dispatchedAt", "timeZone"]);
  if (context.source === "manual" || context.source === "dry-run") return scalarFields(context, ["source", "at", "userId"]);
  if (context.source === "ai_hosted_action" && (hostVisible || context.serverId == null)) {
    return scalarFields(context, ["source", "hostedActionId", "serverId"]);
  }
  // Unrecognized legacy payloads have no reliable mapping from details to their owning host.
  return null;
}

/** Read current ACLs once for all host details about to leave the server. */
export async function projectTriggerContexts(contexts: unknown[], session: TeamSession): Promise<unknown[]> {
  const ids = new Set<string>();
  const objects = contexts.map(record);
  for (const context of objects) {
    if (typeof context?.serverId === "string") ids.add(context.serverId);
    if (Array.isArray(context?.readings)) {
      for (const reading of context.readings) {
        const id = record(reading)?.serverId;
        if (typeof id === "string") ids.add(id);
      }
    }
  }
  const visible = new Set(ids.size && sessionHasPermission(session, "server:read") ? (await prisma.server.findMany({
    where: { id: { in: [...ids] }, ...serverTeamWhere(session, "read") }, select: { id: true },
  })).map((host) => host.id) : []);
  return objects.map((context) => projectContext(context, visible));
}
