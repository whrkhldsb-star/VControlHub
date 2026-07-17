import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { dockerRequest } from "@/lib/docker/engine-client";
import { AuthError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { COMMAND_LIMIT } from "@/lib/http/rate-limit-presets";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { assertServerTeamAccess } from "@/lib/server/team-access";

const resourceKindSchema = z.enum(["networks", "volumes"]);
const resourceNameSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.-]+$/);
const getQuerySchema = z.object({
  type: resourceKindSchema,
  name: resourceNameSchema.optional(),
  serverId: z.string().trim().min(1).optional(),
});
const postBodySchema = z.object({
  type: resourceKindSchema,
  action: z.enum(["create", "delete"]),
  name: resourceNameSchema,
  driver: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_.-]+$/).optional(),
  serverId: z.string().trim().min(1).optional(),
});



export async function GET(req: NextRequest) {
  return withApiRoute(req, { permission: "docker:manage", errorMessage: "Failed to fetch Docker resources" }, async ({ session }) => {
    const { type, name, serverId } = parseSearchParams(req, getQuerySchema);
    if (serverId) {
      const teamAccess = await assertServerTeamAccess(session, serverId);
      if (!teamAccess.ok) return teamAccess.response;
    }
    if (type === "networks") {
      const { result } = await dockerRequest(name ? `/networks/${encodeURIComponent(name)}` : "/networks", {
        serverId, unavailableData: { networks: [], volumes: [] }, loggerScope: "api:docker:resources",
      });
      return NextResponse.json(result);
    }

    const { result } = await dockerRequest(name ? `/volumes/${encodeURIComponent(name)}` : "/volumes", {
      serverId, unavailableData: { networks: [], volumes: [] }, loggerScope: "api:docker:resources",
    });
    return NextResponse.json(result);
  });
}

export async function POST(req: NextRequest) {
  return withApiRoute(
    req,
    { permission: "docker:manage", rateLimit: COMMAND_LIMIT, errorMessage: "Docker resource operation failed", bodySchema: postBodySchema },
    async ({ session, body: input }) => {
      if (!session) throw new AuthError("Not authenticated");
      const { type, action, name, driver = "local", serverId } = input;

      if (serverId) {
        const teamAccess = await assertServerTeamAccess(session, serverId);
        if (!teamAccess.ok) return teamAccess.response;
      }

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

      const { result } = await dockerRequest(path, {
        method, body, serverId,
        unavailableData: { networks: [], volumes: [] },
        loggerScope: "api:docker:resources",
      });
      if (result.dockerAvailable === false) {
        await auditUserAction(
          session.userId,
          `docker.${isNetwork ? "network" : "volume"}.${action}`,
          { name, driver, serverId: serverId || "hub-host", status: 503, ok: false, dockerAvailable: false },
          action === "delete" ? "WARNING" : "INFO",
        );
        return NextResponse.json(
          {
            ok: false,
            status: 503,
            data: { message: result.message ?? "Docker is unavailable" },
            dockerAvailable: false,
            message: result.message ?? "Docker is unavailable",
          },
          { status: 503 },
        );
      }
      await auditUserAction(
        session.userId,
        `docker.${isNetwork ? "network" : "volume"}.${action}`,
        { name, driver, serverId: serverId || "hub-host", status: result.status, ok: result.ok },
        action === "delete" ? "WARNING" : "INFO",
      );
      return NextResponse.json(result, { status: result.ok ? 200 : result.status >= 400 ? result.status : 200 });
    },
  );
}
