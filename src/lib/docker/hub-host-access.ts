/**
 * Guard for the hub-host Docker scope.
 *
 * Every route that can address Docker takes an optional `serverId`: the three
 * `/api/docker/*` routes (`containers`, `resources`, `compose`) and the three
 * quick-service routes (`/api/quick-services`, `/api/quick-services/[slug]`,
 * `/api/quick-services/check-port`). With a `serverId`, the request is scoped to
 * a tenant's own VPS and `assertServerTeamAccess` decides. Without one, it falls
 * through to the hub host — the platform's *own* Docker daemon, reached through
 * the mounted `/var/run/docker.sock`. That socket runs the containers every
 * tenant shares, so `docker compose down` or `container remove` there is a
 * platform-wide action, not a tenant one, and `docker:manage` alone must not
 * authorise it: the permission is part of the default `operator` role.
 *
 * The quick-service surface is the sharper case. `installService` on the hub host
 * runs `docker run` against that daemon, and two catalogue templates (Portainer,
 * Gladys) declare `allowDockerSocket: true` — installing one bind-mounts the
 * daemon socket into a container the tenant then controls, which is a container
 * escape onto the control plane. Uninstall with `deleteVolumes` additionally rm
 * -rf's host paths under /opt and /srv.
 *
 * Note that mounting the socket `:ro` does not make the Docker API read-only —
 * a read-only bind mount protects the socket *file*, not the daemon behind it.
 *
 * This mirrors the rule `serverTeamWhere` already applies to records with no
 * teamId: infrastructure that belongs to no team is reserved for platform
 * managers rather than treated as implicitly shared with everyone.
 */
import { NextResponse } from "next/server";

import type { SessionPayload } from "@/lib/auth/session";
import { isGlobalTeamManager } from "@/lib/auth/team-scope";
import { apiError } from "@/lib/http/api-error";
import { t } from "@/lib/i18n/service-translations";

export type HubHostDockerAccessResult =
	| { ok: true }
	| { ok: false; response: NextResponse };

/**
 * Verify the caller may act on the hub host's Docker daemon.
 *
 * ```ts
 * const hubAccess = assertHubHostDockerAccess(session);
 * if (!hubAccess.ok) return hubAccess.response;
 * ```
 *
 * 403 rather than 404: the hub host is not a record whose existence could be
 * leaked, and the caller needs to understand that picking one of their own
 * servers is the way forward.
 */
export function assertHubHostDockerAccess(
	session: SessionPayload | null,
): HubHostDockerAccessResult {
	if (session && isGlobalTeamManager(session)) return { ok: true };
	return {
		ok: false,
		response: apiError({
			code: "PERMISSION_DENIED",
			message: t("backend.docker.hubHostRequiresPlatformManager"),
			status: 403,
		}),
	};
}
