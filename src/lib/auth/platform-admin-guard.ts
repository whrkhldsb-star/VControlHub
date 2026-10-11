/**
 * Service-level check for operations that belong to the platform role alone,
 * whatever permissions an identity template or token grants: the hub host's
 * resources, the platform self-check, customers and accounts.
 */
import { ForbiddenError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

import type { TeamSession } from "./team-scope";
import { isGlobalTeamManager } from "./team-scope";

export function assertPlatformAdmin(session: TeamSession): void {
	if (!isGlobalTeamManager(session)) throw new ForbiddenError(t("backend.customer.platformOnly"));
}
