/**
 * P3 coverage gap — 2FA setup route (POST generates TOTP secret + otpauth URL,
 * PUT verifies a code). Sibling to enable-disable.test.ts; follows the same
 * withApiRoute / otplib / prisma mocking pattern.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireSessionMock, generateSecretMock, verifyTotpMock, prismaMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  generateSecretMock: vi.fn(),
  verifyTotpMock: vi.fn(),
  prismaMock: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: async (
    request: Request,
    opts: {
      requireAuth?: boolean;
      errorMessage?: string;
      bodySchema?: {
        safeParse: (
          v: unknown,
        ) => { success: true; data: unknown } | { success: false; error: { issues: Array<{ message: string }> } };
      };
    },
    handler: (ctx: { session: { userId: string; username?: string } | null; body: unknown }) => Promise<Response>,
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
  generateSecret: (...args: unknown[]) => generateSecretMock(...args),
  verify: (...args: unknown[]) => verifyTotpMock(...args),
}));

const setupRoute = await import("../setup/route");

function jsonRequest(body: unknown, method: "POST" | "PUT" = "POST"): Request {
  return new Request("http://localhost/api/auth/2fa/setup", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/2fa/setup", () => {
  beforeEach(() => {
    requireSessionMock.mockReset();
    generateSecretMock.mockReset();
    prismaMock.user.findUnique.mockReset();
    requireSessionMock.mockReturnValue({ userId: "u1", username: "alice" });
  });
  afterEach(() => vi.restoreAllMocks());

  it("rejects unauthenticated requests with 401", async () => {
    requireSessionMock.mockReturnValueOnce(null);
    const res = await setupRoute.POST(jsonRequest({}));
    expect(res.status).toBe(401);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("generates a TOTP secret and otpauth URL for QR setup", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ twoFactorEnabled: false });
    generateSecretMock.mockReturnValueOnce("JBSWY3DPEHPK3PXP");

    const res = await setupRoute.POST(jsonRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(body.otpauthUrl).toContain("otpauth://totp/");
    expect(body.otpauthUrl).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
      select: { twoFactorEnabled: true },
    });
  });

  it("refuses to regenerate when 2FA is already enabled", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ twoFactorEnabled: true });

    const res = await setupRoute.POST(jsonRequest({}));

    expect(res.status).toBe(400);
    expect(generateSecretMock).not.toHaveBeenCalled();
  });
});

describe("PUT /api/auth/2fa/setup", () => {
  beforeEach(() => {
    requireSessionMock.mockReset();
    verifyTotpMock.mockReset();
    requireSessionMock.mockReturnValue({ userId: "u1", username: "alice" });
  });
  afterEach(() => vi.restoreAllMocks());

  it("rejects unauthenticated requests with 401", async () => {
    requireSessionMock.mockReturnValueOnce(null);
    const res = await setupRoute.PUT(jsonRequest({ code: "123456", secret: "SECRET" }, "PUT"));
    expect(res.status).toBe(401);
    expect(verifyTotpMock).not.toHaveBeenCalled();
  });

  it("reports valid=true when the TOTP code matches the secret", async () => {
    verifyTotpMock.mockReturnValueOnce(true);
    const res = await setupRoute.PUT(jsonRequest({ code: "123456", secret: "JBSWY3DPEHPK3PXP" }, "PUT"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ valid: true });
    expect(verifyTotpMock).toHaveBeenCalledWith({ token: "123456", secret: "JBSWY3DPEHPK3PXP" });
  });

  it("reports valid=false when the TOTP code does not match", async () => {
    verifyTotpMock.mockReturnValueOnce(false);
    const res = await setupRoute.PUT(jsonRequest({ code: "000000", secret: "JBSWY3DPEHPK3PXP" }, "PUT"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ valid: false });
  });
});
