/**
 * TR-018: API 回归测试基线 - 2FA enable/disable route
 *
 * 覆盖相邻 route 测试基线（权限拒绝 + 参数校验 + 成功路径）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireSessionMock, verifyTotpMock, prismaMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  verifyTotpMock: vi.fn(),
  prismaMock: {
    user: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: async (
    request: Request,
    opts: { requireAuth?: boolean; errorMessage?: string; bodySchema?: { safeParse: (v: unknown) => { success: true; data: unknown } | { success: false; error: { issues: Array<{ message: string }> } } } },
    handler: (ctx: { session: { userId: string } | null; body: unknown }) => Promise<Response>,
  ) => {
    try {
      let body: unknown = undefined;
      if (opts.bodySchema) {
        let raw: unknown = undefined;
        try {
          raw = await request.clone().json();
        } catch {
          const { ValidationError } = await import("@/lib/errors");
          throw new ValidationError("请求体不是合法的 JSON");
        }
        const parsed = opts.bodySchema.safeParse(raw);
        if (!parsed.success) {
          const { ValidationError } = await import("@/lib/errors");
          throw new ValidationError(parsed.error.issues[0]?.message ?? "参数无效");
        }
        body = parsed.data;
      }
      if (opts.requireAuth) {
        const session = requireSessionMock(request);
        if (!session) {
          return new Response(JSON.stringify({ error: "未登录或会话已过期" }), { status: 401 });
        }
        return await handler({ session, body });
      }
      return await handler({ session: null, body });
    } catch (e) {
      // Mirror the real `withApiRoute` catch: route handlers now throw
      // `AppError` subclasses instead of returning `NextResponse.json({...})`,
      // so the mock has to wrap the throw in `apiCatch` to keep test
      // assertions stable. TR-034 R2.
      const { apiCatch } = await import("@/lib/http/api-error");
      return apiCatch(e);
    }
  },
}));

vi.mock("@/lib/http/rate-limit-presets", () => ({
  GENERAL_WRITE_LIMIT: { key: "general-write" },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

vi.mock("otplib", () => ({
  verify: (...args: unknown[]) => verifyTotpMock(...args),
}));

vi.mock("@/lib/auth/two-factor-secret", () => ({
  sealTwoFactorSecret: (secret: string) => `sealed:${secret}`,
  openTwoFactorSecret: (stored: string) =>
    typeof stored === "string" && stored.startsWith("sealed:")
      ? stored.slice("sealed:".length)
      : stored,
}));

const enableRoute = await import("../enable/route");
const disableRoute = await import("../disable/route");

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/auth/2fa/enable", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/2fa/enable", () => {
  beforeEach(() => {
    requireSessionMock.mockReset();
    verifyTotpMock.mockReset();
    prismaMock.user.update.mockReset();
    prismaMock.user.findUnique.mockReset();
    requireSessionMock.mockReturnValue({ userId: "u1" });
    prismaMock.user.findUnique.mockResolvedValue({
      twoFactorEnabled: false,
      twoFactorSecret: null,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("rejects unauthenticated requests with 401", async () => {
    requireSessionMock.mockReturnValueOnce(null);
    const res = await enableRoute.POST(jsonRequest({ code: "000000", secret: "SECRET" }));
    expect(res.status).toBe(401);
  });

  it("rejects malformed body with 400", async () => {
    const res = await enableRoute.POST(
      new Request("http://localhost/api/auth/2fa/enable", {
        method: "POST",
        body: "not-json",
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects invalid TOTP code with 400", async () => {
    verifyTotpMock.mockReturnValueOnce(false);
    const res = await enableRoute.POST(jsonRequest({ code: "111111", secret: "SECRET" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid verification code/);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("refuses to overwrite an already-enabled 2FA secret", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      twoFactorEnabled: true,
      twoFactorSecret: "EXISTING_SECRET",
    });
    verifyTotpMock.mockReturnValueOnce(true);
    const res = await enableRoute.POST(jsonRequest({ code: "123456", secret: "NEW_SECRET" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already enabled/i);
    expect(verifyTotpMock).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("persists sealed secret and enables 2FA on valid code", async () => {
    verifyTotpMock.mockReturnValueOnce(true);
    prismaMock.user.update.mockResolvedValueOnce({});
    const res = await enableRoute.POST(jsonRequest({ code: "123456", secret: "JBSWY3DPEHPK3PXP" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { twoFactorEnabled: true, twoFactorSecret: "sealed:JBSWY3DPEHPK3PXP" },
    });
  });
});

describe("POST /api/auth/2fa/disable", () => {
  beforeEach(() => {
    requireSessionMock.mockReset();
    verifyTotpMock.mockReset();
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.update.mockReset();
    requireSessionMock.mockReturnValue({ userId: "u1" });
  });
  afterEach(() => vi.restoreAllMocks());

  it("rejects unauthenticated requests with 401", async () => {
    requireSessionMock.mockReturnValueOnce(null);
    const res = await disableRoute.POST(jsonRequest({ code: "000000" }));
    expect(res.status).toBe(401);
  });

  it("rejects malformed body with 400", async () => {
    const res = await disableRoute.POST(jsonRequest({}));
    expect(res.status).toBe(400);
  });

  it("rejects when 2FA is not enabled with 400", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      twoFactorEnabled: false,
      twoFactorSecret: null,
    });
    const res = await disableRoute.POST(jsonRequest({ code: "123456" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not enabled/i);
  });

  it("rejects invalid TOTP code with 400", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      twoFactorEnabled: true,
      twoFactorSecret: "EXISTING_SECRET",
    });
    verifyTotpMock.mockReturnValueOnce(false);
    const res = await disableRoute.POST(jsonRequest({ code: "000000" }));
    expect(res.status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("clears 2FA fields on valid code (opens sealed or legacy secret)", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      twoFactorEnabled: true,
      twoFactorSecret: "sealed:EXISTING_SECRET",
    });
    verifyTotpMock.mockReturnValueOnce(true);
    prismaMock.user.update.mockResolvedValueOnce({});
    const res = await disableRoute.POST(jsonRequest({ code: "654321" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
    expect(verifyTotpMock).toHaveBeenCalledWith({ token: "654321", secret: "EXISTING_SECRET" });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
  });
});
