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
      updateMany: vi.fn(),
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

vi.mock("@/lib/auth/two-factor-enrollment", () => ({
  openTwoFactorEnrollmentToken: (token: string, input: { userId: string }) => {
    // Stand-in for the HMAC ticket: "ticket:<userId>:<secret>" opens only for
    // the user it names, anything else is an invalid ticket.
    const parts = token.split(":");
    if (parts[0] !== "ticket" || parts[1] !== input.userId) return null;
    return parts[2] ?? null;
  },
}));

vi.mock("@/lib/auth/two-factor-secret", () => ({
  sealTwoFactorSecret: (secret: string) => `sealed:${secret}`,
  openTwoFactorSecret: (stored: string) =>
    typeof stored === "string" && stored.startsWith("sealed:")
      ? stored.slice("sealed:".length)
      : stored,
}));

const { createTwoFactorRecoveryCodes } = await import("@/lib/auth/two-factor-recovery");

const enableRoute = await import("../enable/route");
const disableRoute = await import("../disable/route");
const recoveryCodesRoute = await import("../recovery-codes/route");

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
    prismaMock.user.updateMany.mockReset();
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
    const res = await enableRoute.POST(
      jsonRequest({ code: "000000", enrollmentToken: "ticket:u1:SECRET" }),
    );
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
    verifyTotpMock.mockReturnValueOnce({ valid: false });
    const res = await enableRoute.POST(
      jsonRequest({ code: "111111", enrollmentToken: "ticket:u1:SECRET" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/验证码无效|Invalid verification code/);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("refuses to overwrite an already-enabled 2FA secret", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      twoFactorEnabled: true,
      twoFactorSecret: "EXISTING_SECRET",
    });
    verifyTotpMock.mockReturnValueOnce({ valid: true });
    const res = await enableRoute.POST(
      jsonRequest({ code: "123456", enrollmentToken: "ticket:u1:NEW_SECRET" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/已启用|already enabled/i);
    expect(verifyTotpMock).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("persists the seed carried by the enrollment ticket, sealed", async () => {
    verifyTotpMock.mockReturnValueOnce({ valid: true });
    prismaMock.user.update.mockResolvedValueOnce({});
    const res = await enableRoute.POST(
      jsonRequest({ code: "123456", enrollmentToken: "ticket:u1:JBSWY3DPEHPK3PXP" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.recoveryCodes).toHaveLength(10);
    expect(body.recoveryCodes.every((code: unknown) => typeof code === "string" && /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2}$/.test(code))).toBe(true);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: expect.objectContaining({
        twoFactorEnabled: true,
        twoFactorSecret: "sealed:JBSWY3DPEHPK3PXP",
        twoFactorRecoveryCodes: expect.any(Array),
      }),
    });
    // The seed verified is the one from the ticket, never one taken from the body.
    expect(verifyTotpMock).toHaveBeenCalledWith({
      token: "123456",
      secret: "JBSWY3DPEHPK3PXP",
    });
  });

  it("refuses a raw secret in the body — the seed must come from a ticket", async () => {
    verifyTotpMock.mockReturnValue({ valid: true });
    const res = await enableRoute.POST(
      jsonRequest({ code: "123456", secret: "ATTACKER_CHOSEN_SEED" }),
    );
    // Schema no longer has a `secret` field, so this is a 400 before any work.
    expect(res.status).toBe(400);
    expect(verifyTotpMock).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("refuses a ticket minted for another account", async () => {
    verifyTotpMock.mockReturnValue({ valid: true });
    const res = await enableRoute.POST(
      jsonRequest({ code: "123456", enrollmentToken: "ticket:u2:VICTIM_SEED" }),
    );
    expect(res.status).toBe(400);
    // Rejected before the TOTP check: there is no seed to check against.
    expect(verifyTotpMock).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("refuses a forged or expired ticket", async () => {
    verifyTotpMock.mockReturnValue({ valid: true });
    const res = await enableRoute.POST(
      jsonRequest({ code: "123456", enrollmentToken: "not-a-ticket" }),
    );
    expect(res.status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/2fa/disable", () => {
  beforeEach(() => {
    requireSessionMock.mockReset();
    verifyTotpMock.mockReset();
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.update.mockReset();
    prismaMock.user.updateMany.mockReset();
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
    expect(body.error).toMatch(/尚未启用|not enabled/i);
  });

  it("rejects invalid TOTP code with 400", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      twoFactorEnabled: true,
      twoFactorSecret: "EXISTING_SECRET",
    });
    verifyTotpMock.mockReturnValueOnce({ valid: false });
    const res = await disableRoute.POST(jsonRequest({ code: "000000" }));
    expect(res.status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("clears 2FA fields on valid code (opens sealed or legacy secret)", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      twoFactorEnabled: true,
      twoFactorSecret: "sealed:EXISTING_SECRET",
    });
    verifyTotpMock.mockReturnValueOnce({ valid: true });
    prismaMock.user.update.mockResolvedValueOnce({});
    const res = await disableRoute.POST(jsonRequest({ code: "654321" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
    expect(verifyTotpMock).toHaveBeenCalledWith({ token: "654321", secret: "EXISTING_SECRET" });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: expect.objectContaining({
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorRecoveryCodes: expect.anything(),
      }),
    });
  });

  it("accepts a recovery code so a lost authenticator is not a permanent lockout", async () => {
    const generated = createTwoFactorRecoveryCodes(3);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      twoFactorEnabled: true,
      twoFactorSecret: "sealed:EXISTING_SECRET",
      twoFactorRecoveryCodes: generated.hashes,
    });
    verifyTotpMock.mockReturnValue({ valid: false });
    prismaMock.user.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.user.update.mockResolvedValueOnce({});

    const res = await disableRoute.POST(jsonRequest({ code: generated.codes[0]! }));

    expect(res.status).toBe(200);
    // The code is burned on the way through, even though 2FA is being turned off.
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u1", twoFactorRecoveryCodes: { equals: generated.hashes } },
      data: { twoFactorRecoveryCodes: [generated.hashes[1], generated.hashes[2]] },
    });
    expect(prismaMock.user.update).toHaveBeenCalled();
  });

  it("rejects input that is neither factor before reading the user row", async () => {
    const res = await disableRoute.POST(jsonRequest({ code: "12345" }));
    expect(res.status).toBe(400);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/2fa/recovery-codes", () => {
  beforeEach(() => {
    requireSessionMock.mockReset();
    verifyTotpMock.mockReset();
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.update.mockReset();
    prismaMock.user.updateMany.mockReset();
    requireSessionMock.mockReturnValue({ userId: "u1" });
    prismaMock.user.findUnique.mockResolvedValue({
      twoFactorEnabled: true,
      twoFactorSecret: "sealed:EXISTING_SECRET",
    });
  });

  it("requires a current authenticator code before replacing recovery codes", async () => {
    verifyTotpMock.mockReturnValueOnce({ valid: true });
    prismaMock.user.update.mockResolvedValueOnce({});

    const response = await recoveryCodesRoute.POST(jsonRequest({ code: "123456" }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.recoveryCodes).toHaveLength(10);
    expect(verifyTotpMock).toHaveBeenCalledWith({ token: "123456", secret: "EXISTING_SECRET" });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { twoFactorRecoveryCodes: expect.any(Array) },
    });
  });

  it("rejects an invalid current authenticator code", async () => {
    verifyTotpMock.mockReturnValueOnce({ valid: false });

    const response = await recoveryCodesRoute.POST(jsonRequest({ code: "000000" }));

    expect(response.status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("also accepts one of the current recovery codes", async () => {
    const generated = createTwoFactorRecoveryCodes(2);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      twoFactorEnabled: true,
      twoFactorSecret: "sealed:EXISTING_SECRET",
      twoFactorRecoveryCodes: generated.hashes,
    });
    verifyTotpMock.mockReturnValue({ valid: false });
    prismaMock.user.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.user.update.mockResolvedValueOnce({});

    const response = await recoveryCodesRoute.POST(
      jsonRequest({ code: generated.codes[1]! }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.recoveryCodes).toHaveLength(10);
    // The consumed code is irrelevant afterwards — `update` replaces the whole set.
    expect(prismaMock.user.updateMany).toHaveBeenCalled();
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { twoFactorRecoveryCodes: expect.any(Array) },
    });
  });

  it("rejects a recovery code that is not one of the stored ones", async () => {
    const generated = createTwoFactorRecoveryCodes(2);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      twoFactorEnabled: true,
      twoFactorSecret: "sealed:EXISTING_SECRET",
      twoFactorRecoveryCodes: generated.hashes,
    });
    verifyTotpMock.mockReturnValue({ valid: false });

    const response = await recoveryCodesRoute.POST(
      jsonRequest({ code: "AAAA-BBBB-CCCC" }),
    );

    expect(response.status).toBe(400);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
