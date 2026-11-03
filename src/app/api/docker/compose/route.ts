import { apiCopy } from "@/lib/i18n/api-copy";
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
import { assertHubHostDockerAccess } from "@/lib/docker/hub-host-access";

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
      errorMessage: apiCopy("apiCopy.failed.to.list.compose.projects.02edfd31"),
    },
    async ({ session }) => {
      const { serverId } = parseSearchParams(request, listQuerySchema);
      if (serverId) {
        const teamAccess = await assertServerTeamAccess(session, serverId, "connect");
        if (!teamAccess.ok) return teamAccess.response;
      } else {
        // No serverId means the hub host's own daemon — shared platform
        // infrastructure, not this tenant's.
        const hubAccess = assertHubHostDockerAccess(session);
        if (!hubAccess.ok) return hubAccess.response;
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
      errorMessage: apiCopy("apiCopy.compose.project.action.failed.aa46095b"),
    },
    async ({ session, body }) => {
      const serverId = body.serverId?.trim() || undefined;
      if (serverId) {
        const teamAccess = await assertServerTeamAccess(session, serverId, "manage");
        if (!teamAccess.ok) return teamAccess.response;
      } else {
        // `down` on a hub-host project can stop the platform itself.
        const hubAccess = assertHubHostDockerAccess(session);
        if (!hubAccess.ok) return hubAccess.response;
      }
      let result: Awaited<ReturnType<typeof runComposeProjectAction>>;
      try {
        result = await runComposeProjectAction({
          project: body.project,
          action: body.action,
          serverId,
          removeVolumes: body.removeVolumes === true,
        });
      } catch (error) {
        // A failed or timed-out `down --volumes` left no trace at all (A6-07).
        if (body.action !== "ps") {
          try {
            await auditUserAction(session.userId, `docker.compose.${body.action}.failed`, {
              project: body.project,
              serverId: serverId ?? "hub-host",
              removeVolumes: body.removeVolumes === true,
              error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
            }, undefined, session.currentTeamId);
          } catch {
            // The original failure is what the caller must see.
          }
        }
        throw error;
      }

      if (body.action !== "ps") {
        await auditUserAction(session.userId, `docker.compose.${body.action}`, {
          project: result.project,
          mode: result.mode,
          serverId: serverId ?? "hub-host",
          removeVolumes: body.removeVolumes === true,
        }, undefined, session.currentTeamId);
      }

      return NextResponse.json({
        success: true,
        ...result,
      });
    },
  );
}
