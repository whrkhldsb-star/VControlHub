import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiPermissionMock, requireApiSessionMock, withRateLimitMock } = vi.hoisted(() => ({
  requireApiPermissionMock: vi.fn(),
  requireApiSessionMock: vi.fn(),
  withRateLimitMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: requireApiPermissionMock }));
vi.mock("@/lib/auth/api-session", () => ({ requireApiSession: requireApiSessionMock }));
vi.mock("@/lib/http/rate-limit-presets", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http/rate-limit-presets")>("@/lib/http/rate-limit-presets");
  return { ...actual, withRateLimit: withRateLimitMock };
});

const { withApiRoute } = await import("@/lib/http/api-guard");

const session = { userId: "u1", username: "admin", roles: ["admin"] };

function request() {
  return new Request("https://example.test/api/demo");
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("api guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValue({ session });
    requireApiSessionMock.mockResolvedValue(session);
    withRateLimitMock.mockResolvedValue({ allowed: true, retryAfterMs: 0, remaining: 1 });
  });

  it("passes the authorized session into the route handler", async () => {
    const response = await withApiRoute(request(), { permission: "snippet:manage" }, async ({ session }) => {
      return Response.json({ userId: session?.userId });
    });

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ userId: "u1" });
    expect(requireApiPermissionMock).toHaveBeenCalledWith("snippet:manage");
  });

  it("returns permission responses before invoking the route handler", async () => {
    requireApiPermissionMock.mockResolvedValueOnce(Response.json({ error: "缺少权限" }, { status: 403 }));
    const handler = vi.fn(async () => Response.json({ ok: true }));

    const response = await withApiRoute(request(), { permission: "snippet:manage" }, handler);

    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({ error: "缺少权限" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("applies rate limiting before auth", async () => {
    withRateLimitMock.mockResolvedValueOnce({ allowed: false, retryAfterMs: 2500, remaining: 0 });
    const handler = vi.fn(async () => Response.json({ ok: true }));

    const response = await withApiRoute(request(), { permission: "snippet:manage", rateLimit: { maxRequests: 1, windowMs: 1000 } }, handler);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3");
    expect(requireApiPermissionMock).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("can require auth without requiring a specific permission", async () => {
    const response = await withApiRoute(request(), { requireAuth: true }, async ({ session }) => {
      return Response.json({ userId: session?.userId });
    });

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ userId: "u1" });
    expect(requireApiSessionMock).toHaveBeenCalledTimes(1);
  });

  it("returns api-session 401 responses for auth-only routes", async () => {
    requireApiSessionMock.mockResolvedValueOnce(Response.json({ error: "未登录或会话已过期" }, { status: 401 }));
    const handler = vi.fn(async () => Response.json({ ok: true }));

    const response = await withApiRoute(request(), { requireAuth: true }, handler);

    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ error: "未登录或会话已过期" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("converts thrown errors to json responses", async () => {
    const response = await withApiRoute(request(), {}, async () => {
      throw new Error("boom");
    });

    expect(response.status).toBe(500);
    expect(await json(response)).toEqual({ error: "boom" });
  });

  it("supports route-specific error mapping", async () => {
    const response = await withApiRoute(
      request(),
      {
        onError(error) {
          const message = error instanceof Error ? error.message : "failed";
          return Response.json({ error: message, custom: true }, { status: message.includes("端口") ? 409 : 500 });
        },
      },
      async () => {
        throw new Error("端口 8080 已被占用");
      },
    );

    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({ error: "端口 8080 已被占用", custom: true });
  });
});
