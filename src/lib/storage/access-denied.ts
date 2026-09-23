import { t, type Locale } from "@/lib/i18n/service-translations";

/**
 * Render an `assertStorageAccess` denial code as localized copy.
 *
 * `assertStorageAccess` returns stable machine-readable codes in
 * `decision.reason` (see `STORAGE_ACCESS_DENIED_REASONS` in access-control.ts)
 * so callers never leak raw English strings to clients. API routes and service
 * modules pass the decision through this helper at the edge:
 *
 *   if (!decision.allowed) {
 *     return apiError({ code: "FORBIDDEN", message: storageAccessDeniedCopy(decision.reason), status: 403 });
 *   }
 *
 * Unknown/missing codes fall back to the generic no-access copy, so a caller
 * that forgets to normalize still gets translated output.
 */
const REASON_COPY_KEYS: Record<string, string> = {
	no_permission: "backend.storageHardening.access.noPermission",
	no_access: "backend.storageHardening.access.noAccess",
	path_not_allowed: "backend.storageHardening.access.pathNotAllowed",
	file_too_large: "backend.storageHardening.access.fileTooLarge",
	quota_exceeded: "backend.storageHardening.access.quotaExceeded",
};

const FALLBACK_COPY_KEY = "backend.storageHardening.access.noAccess";

export function storageAccessDeniedCopy(
	reason?: string | null,
	locale?: Locale,
): string {
	const key =
		(reason ? REASON_COPY_KEYS[reason] : undefined) ?? FALLBACK_COPY_KEY;
	return t(key, locale ?? "zh");
}
