/**
 * Docker containers API — list, inspect, start/stop/restart, logs.
 * Uses Docker Engine API via Node.js HTTP over unix socket /var/run/docker.sock
 * Zero child_process calls — pure Node.js HTTP, no curl, no injection risk.
 *
 * GET /api/docker/containers — list containers
 * GET /api/docker/containers?id=xxx — inspect one container
 * POST /api/docker/containers — start/stop/restart {id, action}
 * GET /api/docker/containers?logs=xxx — get container logs
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { dockerRequest } from "@/lib/docker/engine-client";
import { parseDockerStats } from "@/lib/docker/stats";
import { withApiRoute } from "@/lib/http/api-guard";
import { COMMAND_LIMIT } from "@/lib/http/rate-limit-presets";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { AuthError } from "@/lib/errors";

const containerActionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["start", "stop", "restart", "remove"]),
  serverId: z.string().trim().min(1).optional(),
});



/** Validate Docker container ID: only allow hex chars and names (alphanumeric + _.-) */
function isValidDockerId(value: string): boolean {
  return /^[a-zA-Z0-9_.-]+$/.test(value) && value.length <= 128;
}

/** Validate tail parameter: only allow positive integers */
function isValidTail(value: string): boolean {
  return /^\d{1,5}$/.test(value) && parseInt(value, 10) <= 50000;
}

/**
 * Call Docker Engine API via Node.js HTTP over unix socket.
 * No curl, no child_process — pure Node.js http.request.
 */
export async function GET(req: NextRequest) {
  return withApiRoute(
    req,
    { permission: "docker:manage", errorMessage: "Docker API RequestFailed" },
    async () => {
      const { id, logs, stats, tail: tailRaw, serverId } = parseSearchParams(
        req,
        z.object({
          id: z.string().trim().min(1).optional(),
          logs: z.string().trim().min(1).optional(),
          stats: z.string().trim().min(1).optional(),
          tail: z.string().trim().min(1).optional(),
          serverId: z.string().trim().min(1).optional(),
        }),
      );
      const tail = tailRaw && isValidTail(tailRaw) ? tailRaw : "100";

      // Validate container IDs to prevent path traversal
      if (id && !isValidDockerId(id)) {
        return NextResponse.json(
          { error: "Invalid container ID format" },
          { status: 400 },
        );
      }
      if (logs && !isValidDockerId(logs)) {
        return NextResponse.json(
          { error: "Invalid container ID format" },
          { status: 400 },
        );
      }
      if (stats && !isValidDockerId(stats)) {
        return NextResponse.json(
          { error: "Invalid container ID format" },
          { status: 400 },
        );
      }

      if (stats) {
        const { result: statsResult } = await dockerRequest(
          `/containers/${stats}/stats?stream=false`,
          { serverId, unavailableData: {}, loggerScope: "api:docker:containers" },
        );
        if (!statsResult.ok) return NextResponse.json(statsResult);
        const { result: detailResult } = await dockerRequest(
          `/containers/${stats}/json`,
          { serverId, unavailableData: {}, loggerScope: "api:docker:containers" },
        );
        const detailData =
          detailResult.data && typeof detailResult.data === "object"
            ? (detailResult.data as { Name?: string })
            : {};
        const name = detailData.Name?.replace(/^\//, "") || stats.slice(0, 12);
        return NextResponse.json({
          ok: true,
          status: statsResult.status,
          data: parseDockerStats(
            stats,
            name,
            statsResult.data as Record<string, unknown>,
          ),
        });
      }

      if (logs) {
        const { result: logsResult, scope: logsScope } = await dockerRequest(
          `/containers/${logs}/logs?stdout=true&stderr=true&tail=${tail}`,
          { serverId, unavailableData: {}, loggerScope: "api:docker:containers" },
        );
        return NextResponse.json({ ...logsResult, dockerScope: logsScope });
      }

      if (id) {
        const { result: inspectResult, scope: inspectScope } = await dockerRequest(
          `/containers/${id}/json`,
          { serverId, unavailableData: {}, loggerScope: "api:docker:containers" },
        );
        return NextResponse.json({ ...inspectResult, dockerScope: inspectScope });
      }

      const { result: listResult, scope: listScope } = await dockerRequest(
        "/containers/json?all=true",
        { serverId, unavailableData: [], loggerScope: "api:docker:containers" },
      );
      return NextResponse.json({ ...listResult, dockerScope: listScope });
    },
  );
}

export async function POST(req: NextRequest) {
  return withApiRoute(
    req,
    {
      permission: "docker:manage",
      rateLimit: COMMAND_LIMIT,
      errorMessage: "Docker operation failed",
      bodySchema: containerActionSchema,
    },
    async ({ session, body }) => {
      if (!session)
        throw new AuthError("Not authenticated");

      const { id, action, serverId } = body;

      // Validate container ID to prevent path traversal
      if (!isValidDockerId(id)) {
        return NextResponse.json(
          { error: "Invalid container ID format" },
          { status: 400 },
        );
      }

      const actionMap: Record<string, { path: string; method: string }> = {
        start: { path: `/containers/${id}/start`, method: "POST" },
        stop: { path: `/containers/${id}/stop`, method: "POST" },
        restart: { path: `/containers/${id}/restart`, method: "POST" },
        remove: { path: `/containers/${id}?force=true`, method: "DELETE" },
      };

      const target = actionMap[action]!;
      const { result } = await dockerRequest(target.path, {
        method: target.method,
        serverId,
        unavailableData: {},
        loggerScope: "api:docker:containers",
      });
      await auditUserAction(
        session.userId,
        `docker.container.${action}`,
        {
          containerId: id,
          serverId: serverId || "hub-host",
          status: result.status,
          ok: result.ok,
        },
        action === "remove" ? "WARNING" : "INFO",
      );
      return NextResponse.json(result, { status: result.ok ? 200 : result.status });
    },
  );
}
