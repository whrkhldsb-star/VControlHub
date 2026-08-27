import { sessionHasPermission } from "@/lib/auth/authorization";
import type { SessionPayload } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

/**
 * AI-ops scans collect fleet-health signals GLOBALLY (across every team) and the
 * AiOpsLog model has no teamId, so its logs/summary are inherently cross-tenant.
 * Reading them is therefore a platform-admin capability, not a per-team one.
 *
 * `ai:ops:read` has been removed from the operator/viewer role defaults; this
 * check is defense-in-depth so a custom DB role that is (mis)granted `ai:ops:read`
 * still cannot read cross-team aggregates without global team-management rights.
 * Admins hold `team:manage`; the manage/autonomous routes already gate on the
 * admin-only `ai:ops:manage` / `ai:ops:autonomous` permissions.
 */
export function assertAiOpsPlatformReader(session: SessionPayload | null): void {
  if (!session || !sessionHasPermission(session, "team:manage")) {
    throw new ForbiddenError(t("backend.ai.opsRecordsRequirePlatformAdmin"));
  }
}
