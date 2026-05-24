import type { SessionPayload } from "@/lib/auth/session";
import type { Permission } from "@/lib/auth/rbac";
import { requireApiPermission } from "@/lib/auth/require-api-permission";
import { type RateLimitConfig, rateLimitResponse, withRateLimit } from "@/lib/http/rate-limit-presets";

export type ApiGuardOptions = {
	request: Request;
	permission?: Permission;
	rateLimit?: RateLimitConfig;
};

export async function enforceApiGuard(options: ApiGuardOptions): Promise<Response | SessionPayload | null> {
	const { request, permission, rateLimit } = options;

	if (rateLimit) {
		const rl = withRateLimit(request, rateLimit);
		if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
	}

	if (!permission) return null;

	const result = await requireApiPermission(permission);
	if (result instanceof Response) return result;
	return result.session;
}
