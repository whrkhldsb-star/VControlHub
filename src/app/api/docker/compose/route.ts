/**
 * GET  /api/docker/compose          — list compose projects on hub-host or remote VPS
 * POST /api/docker/compose          — project lifecycle: ps|up|down|start|stop|restart
 *
 * Permission: docker:manage
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import {
  listComposeProjects,
  runComposeProjectAction,
} from "@/lib/docker/compose-projects";
import { withApiRoute } from "@/lib/http/api-guard";
import { COMMAND_LIMIT, GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { assertServerTeamAccess } from "@/lib/server/team-access";

const listQuerySchema = z.object({
  serverId: z.string().trim().min(1).optional(),
});

const actionSchema = z.object({
  project: z.string().trim().min(1).max(128),
  action: z.enum(["ps", "up", "down", "start", "stop", "restart"]),
  serverId: z.string().trim().min(1).optional().nullable(),
  /** Only honored for `down` when compose CLI path is used. */
  removeVolumes: z.boolean().optional(),
});

export async function GET(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "docker:manage",
      rateLimit: GENERAL_READ_LIMIT,
      errorMessage: "Failed to list compose projects",
    },
    async ({ session }) => {
      const { serverId } = parseSearchParams(request, listQuerySchema);
      if (serverId) {
        const teamAccess = await assertServerTeamAccess(session, serverId);
        if (!teamAccess.ok) return teamAccess.response;
      }
      const result = await listComposeProjects(serverId);
      return NextResponse.json({
        projects: result.projects,
        dockerScope: result.scope,
        dockerAvailable: result.dockerAvailable,
        message: result.message ?? null,
      });
    },
  );
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "docker:manage",
      rateLimit: COMMAND_LIMIT,
      bodySchema: actionSchema,
      errorMessage: "Compose project action failed",
    },
    async ({ session, body }) => {
      const serverId = body.serverId?.trim() || undefined;
      if (serverId) {
        const teamAccess = await assertServerTeamAccess(session, serverId);
        if (!teamAccess.ok) return teamAccess.response;
      }
      const result = await runComposeProjectAction({
        project: body.project,
        action: body.action,
        serverId,
        removeVolumes: body.removeVolumes === true,
      });

      if (body.action !== "ps") {
        await auditUserAction(session!.userId, `docker.compose.${body.action}`, {
          project: result.project,
          mode: result.mode,
          serverId: serverId ?? "hub-host",
          removeVolumes: body.removeVolumes === true,
        });
      }

      return NextResponse.json({
        success: true,
        ...result,
      });
    },
  );
}
