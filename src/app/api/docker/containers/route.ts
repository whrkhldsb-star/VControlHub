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
import http from "node:http";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { parseDockerStats } from "@/lib/docker/stats";
import { withApiRoute } from "@/lib/http/api-guard";
import { COMMAND_LIMIT } from "@/lib/http/rate-limit-presets";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { createLogger } from "@/lib/logging";

import { AuthError } from "@/lib/errors";
const logger = createLogger("api:docker:containers");

const containerActionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["start", "stop", "restart", "remove"]),
});

const DOCKER_SOCKET = "/var/run/docker.sock";
const DOCKER_API_HOST = "localhost";
const DOCKER_UNAVAILABLE_CODES = new Set(["ENOENT", "ECONNREFUSED", "EACCES"]);
const hubHostDockerScope = {
  scope: "hub-host",
  socketPath: DOCKER_SOCKET,
  warning:
    "The Docker module only operates on the VControlHub host's Docker socket; it is not a cross-VPS container console. Users with docker:manage permission can manage local containers.",
};
const dockerUnavailableResponse = {
  ok: true,
  status: 200,
  data: [],
  dockerAvailable: false,
  message: "Docker is not installed or Docker socket is unavailable",
  dockerScope: hubHostDockerScope,
};

function isDockerSocketUnavailable(error: unknown) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && DOCKER_UNAVAILABLE_CODES.has(code);
}

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
function dockerRequest(
  apiPath: string,
  method = "GET",
  body?: string,
): Promise<{ ok: boolean; status: number; data: unknown; dockerScope?: typeof hubHostDockerScope; dockerAvailable?: boolean; message?: string }> {
  return new Promise((resolve) => {
    const options: http.RequestOptions = {
      socketPath: DOCKER_SOCKET,
      path: apiPath,
      method,
      host: DOCKER_API_HOST,
      headers: body
        ? {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          }
        : {},
      timeout: 10000,
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        let data: unknown;
        try {
          data = JSON.parse(raw);
        } catch {
          // Response is not valid JSON — return the raw string as-is.
          data = raw;
        }
        resolve({
          ok: res.statusCode! >= 200 && res.statusCode! < 300,
          status: res.statusCode!,
          data,
          dockerScope: hubHostDockerScope,
        });
      });
    });

    req.on("error", (err) => {
      if (isDockerSocketUnavailable(err)) {
        logger.warn("Docker socket unavailable", err, { apiPath, method });
        resolve(dockerUnavailableResponse);
        return;
      }
      logger.error("Docker socket request failed", err, { apiPath, method });
      resolve({
        ok: false,
        status: 502,
        data: { message: "Docker daemon unreachable" },
      });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({
        ok: false,
        status: 504,
        data: { message: "Docker API timeout" },
      });
    });

    if (body) req.write(body);
    req.end();
  });
}

export async function GET(req: NextRequest) {
  return withApiRoute(
    req,
    { permission: "docker:manage", errorMessage: "Docker API RequestFailed" },
    async () => {
      const { id, logs, stats, tail: tailRaw } = parseSearchParams(
        req,
        z.object({
          id: z.string().trim().min(1).optional(),
          logs: z.string().trim().min(1).optional(),
          stats: z.string().trim().min(1).optional(),
          tail: z.string().trim().min(1).optional(),
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
        const result = await dockerRequest(
          `/containers/${stats}/stats?stream=false`,
        );
        if (!result.ok) return NextResponse.json(result);
        const detail = await dockerRequest(`/containers/${stats}/json`);
        const detailData =
          detail.data && typeof detail.data === "object"
            ? (detail.data as { Name?: string })
            : {};
        const name = detailData.Name?.replace(/^\//, "") || stats.slice(0, 12);
        return NextResponse.json({
          ok: true,
          status: result.status,
          data: parseDockerStats(
            stats,
            name,
            result.data as Record<string, unknown>,
          ),
        });
      }

      if (logs) {
        const result = await dockerRequest(
          `/containers/${logs}/logs?stdout=true&stderr=true&tail=${tail}`,
        );
        return NextResponse.json(result);
      }

      if (id) {
        const result = await dockerRequest(`/containers/${id}/json`);
        return NextResponse.json(result);
      }

      const result = await dockerRequest("/containers/json?all=true");
      return NextResponse.json({ ...result, dockerScope: hubHostDockerScope });
    },
  );
}

export async function POST(req: NextRequest) {
  return withApiRoute(
    req,
    {
      permission: "docker:manage",
      rateLimit: COMMAND_LIMIT,
      errorMessage: "Docker OperationFailed",
      bodySchema: containerActionSchema,
    },
    async ({ session, body }) => {
      if (!session)
        throw new AuthError("Not authenticated");

      const { id, action } = body;

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
      const result = await dockerRequest(target.path, target.method);
      await auditUserAction(
        session.userId,
        `docker.container.${action}`,
        {
          containerId: id,
          status: result.status,
          ok: result.ok,
        },
        action === "remove" ? "WARNING" : "INFO",
      );
      return NextResponse.json(result);
    },
  );
}
