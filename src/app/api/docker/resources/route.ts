import http from "node:http";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { AuthError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { COMMAND_LIMIT } from "@/lib/http/rate-limit-presets";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { createLogger } from "@/lib/logging";

const logger = createLogger("api:docker:resources");

const DOCKER_SOCKET = "/var/run/docker.sock";
const DOCKER_API_HOST = "localhost";
const DOCKER_UNAVAILABLE_CODES = new Set(["ENOENT", "ECONNREFUSED", "EACCES"]);

const resourceKindSchema = z.enum(["networks", "volumes"]);
const resourceNameSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.-]+$/);
const getQuerySchema = z.object({
  type: resourceKindSchema,
  name: resourceNameSchema.optional(),
});
const postBodySchema = z.object({
  type: resourceKindSchema,
  action: z.enum(["create", "delete"]),
  name: resourceNameSchema,
  driver: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_.-]+$/).optional(),
});

type DockerResult = {
  ok: boolean;
  status: number;
  data: unknown;
  dockerAvailable?: boolean;
  message?: string;
};

const dockerUnavailableResponse: DockerResult = {
  ok: true,
  status: 200,
  data: { networks: [], volumes: [] },
  dockerAvailable: false,
  message: "Docker is not installed or Docker socket is unavailable",
};

function isDockerSocketUnavailable(error: unknown) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && DOCKER_UNAVAILABLE_CODES.has(code);
}

function dockerRequest(apiPath: string, method = "GET", body?: string): Promise<DockerResult> {
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
          data = raw ? JSON.parse(raw) : null;
        } catch {
          // Response is not valid JSON — return the raw string as-is.
          data = raw;
        }
        resolve({ ok: res.statusCode! >= 200 && res.statusCode! < 300, status: res.statusCode!, data });
      });
    });

    req.on("error", (err) => {
      if (isDockerSocketUnavailable(err)) {
        logger.warn("Docker socket unavailable", err, { apiPath, method });
        resolve(dockerUnavailableResponse);
        return;
      }
      logger.error("Docker socket request failed", err, { apiPath, method });
      resolve({ ok: false, status: 502, data: { message: "Docker daemon unreachable" } });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, status: 504, data: { message: "Docker API timeout" } });
    });

    if (body) req.write(body);
    req.end();
  });
}

export async function GET(req: NextRequest) {
  return withApiRoute(req, { permission: "docker:manage", errorMessage: "Failed to fetch Docker resources" }, async () => {
    const { type, name } = parseSearchParams(req, getQuerySchema);
    if (type === "networks") {
      const result = await dockerRequest(name ? `/networks/${encodeURIComponent(name)}` : "/networks");
      return NextResponse.json(result);
    }

    const result = await dockerRequest(name ? `/volumes/${encodeURIComponent(name)}` : "/volumes");
    return NextResponse.json(result);
  });
}

export async function POST(req: NextRequest) {
  return withApiRoute(
    req,
    { permission: "docker:manage", rateLimit: COMMAND_LIMIT, errorMessage: "Docker resource operation failed", bodySchema: postBodySchema },
    async ({ session, body: input }) => {
      if (!session) throw new AuthError("Not authenticated");
      const { type, action, name, driver = "local" } = input;

      const isNetwork = type === "networks";
      const path = isNetwork
        ? action === "create"
          ? "/networks/create"
          : `/networks/${encodeURIComponent(name)}`
        : action === "create"
          ? "/volumes/create"
          : `/volumes/${encodeURIComponent(name)}`;
      const method = action === "create" ? "POST" : "DELETE";
      const body = action === "create"
        ? JSON.stringify(isNetwork ? { Name: name, Driver: driver } : { Name: name, Driver: driver })
        : undefined;

      const result = await dockerRequest(path, method, body);
      await auditUserAction(
        session.userId,
        `docker.${isNetwork ? "network" : "volume"}.${action}`,
        { name, driver, status: result.status, ok: result.ok },
        action === "delete" ? "WARNING" : "INFO",
      );
      return NextResponse.json(result);
    },
  );
}
