import type { SessionPayload } from "@/lib/auth/session";
import type { Permission } from "@/lib/auth/rbac";
import { requireApiPermission } from "@/lib/auth/require-api-permission";
import { requireApiSession } from "@/lib/auth/api-session";
import { apiCatch } from "@/lib/http/api-error";
import { type RateLimitConfig, rateLimitResponse, withRateLimit } from "@/lib/http/rate-limit-presets";

export type ApiGuardOptions = {
  request: Request;
  permission?: Permission;
  rateLimit?: RateLimitConfig;
};

export type ApiRouteOptions = {
  permission?: Permission;
  requireAuth?: boolean;
  rateLimit?: RateLimitConfig;
  errorStatus?: number;
  errorMessage?: string;
  onError?: (error: unknown) => Response;
};

export type ApiRouteContext = {
  session: SessionPayload | null;
};

export async function enforceApiGuard(options: ApiGuardOptions): Promise<Response | SessionPayload | null> {
  const { request, permission, rateLimit } = options;

  if (rateLimit) {
    const rl = await withRateLimit(request, rateLimit);
    if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);
  }

  if (!permission) return null;

  const result = await requireApiPermission(permission);
  if (result instanceof Response) return result;
  return result.session;
}

export async function withApiRoute(
  request: Request,
  options: ApiRouteOptions,
  handler: (context: ApiRouteContext) => Promise<Response>,
): Promise<Response> {
  try {
    const guard = await enforceApiGuard({ request, permission: options.permission, rateLimit: options.rateLimit });
    if (guard instanceof Response) return guard;

    let session = guard;
    if (!session && options.requireAuth) {
      const apiSession = await requireApiSession();
      if (apiSession instanceof Response) return apiSession;
      session = apiSession;
    }

    return await handler({ session });
  } catch (error) {
    if (options.onError) return options.onError(error);
    return apiCatch(error, options.errorStatus ?? 500, options.errorMessage ?? "操作失败");
  }
}
