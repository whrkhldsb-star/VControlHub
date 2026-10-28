import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { authenticateUserMock, createSessionTokenMock, createPending2faTokenMock, turnstileConfigMock } = vi.hoisted(() => ({
  turnstileConfigMock: vi.fn<() => Promise<{ siteKey: string; secretKey: string } | null>>(async () => null),
  authenticateUserMock: vi.fn(),
  createSessionTokenMock: vi.fn(async () => "session-token"),
  createPending2faTokenMock: vi.fn(async () => "pending-token"),
}));

vi.mock("@/lib/auth/service", () => ({ authenticateUser: authenticateUserMock }));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    createSessionToken: createSessionTokenMock,
    createPending2faToken: createPending2faTokenMock,
    getSessionCookieName: () => "test_session",
    getPending2faCookieName: () => "test_pending_2fa",
  };
});
vi.mock("@/lib/audit/service", () => ({
  auditUserAction: vi.fn(),
  auditSystemAction: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimitAsync: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
  getClientIp: vi.fn(() => "127.0.0.1"),
  LOGIN_RATE_LIMIT: { windowMs: 1, max: 10 },
  LOGIN_SLOW_RATE_LIMIT: { windowMs: 1, max: 100 },
  isAccountLockedAsync: vi.fn(async () => ({ locked: false })),
  recordLoginFailureAsync: vi.fn(async () => ({ locked: false, failCount: 1 })),
  clearLoginFailureAsync: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth/turnstile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/turnstile")>()),
  getTurnstileConfig: turnstileConfigMock,
}));
vi.mock("@/lib/auth/csrf", () => ({
  generateCsrfToken: () => "csrf-token",
  getCsrfCookieName: () => "csrf_token",
}));

import { POST } from "../route";
import { MAX_NON_FILE_FORM_BYTES } from "@/lib/http/request-body";

function makeLoginRequest(body: Record<string, string>) {
  return new Request("https://console.example.test/api/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}

describe("POST /api/login", () => {
  const oldEnv = { ...process.env };
  const credentialBinding = { fingerprint: "proved-password", epoch: 3 };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...oldEnv };
    authenticateUserMock.mockResolvedValue({
      id: "u_1",
      username: "admin",
      roles: ["admin"],
      mustChangePassword: false,
      preferences: { defaultPage: "/", dashboardWidgets: ["server-status", "quick-links", "analytics", "audit-log"], notificationsEnabled: true, notificationSound: true, autoRefreshInterval: 30 },
      twoFactorEnabled: false,
      hasTwoFactorSecret: false,
      credentialBinding,
    });
  });

  afterEach(() => {
    process.env = oldEnv;
  });

  describe("with Cloudflare Turnstile on", () => {
    const siteverify = vi.fn();
    beforeEach(() => {
      turnstileConfigMock.mockResolvedValue({ siteKey: "site", secretKey: "secret" });
      vi.stubGlobal("fetch", siteverify);
    });
    afterEach(() => { vi.unstubAllGlobals(); turnstileConfigMock.mockResolvedValue(null); });

    it("refuses a login without the widget's token before checking the password", async () => {
      const response = await POST(makeLoginRequest({ username: "admin", password: "secret", next: "/servers" }));
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/login?error=captcha&next=%2Fservers");
      expect(authenticateUserMock).not.toHaveBeenCalled();
      expect(siteverify).not.toHaveBeenCalled();
    });

    it("refuses a token Cloudflare rejects, and lets one it accepts through to the password", async () => {
      siteverify.mockResolvedValueOnce(new Response(JSON.stringify({ success: false, "error-codes": ["timeout-or-duplicate"] })));
      const refused = await POST(makeLoginRequest({ username: "admin", password: "secret", "cf-turnstile-response": "spent" }));
      expect(refused.headers.get("location")).toBe("/login?error=captcha");
      expect(authenticateUserMock).not.toHaveBeenCalled();

      siteverify.mockResolvedValueOnce(new Response(JSON.stringify({ success: true })));
      const accepted = await POST(makeLoginRequest({ username: "admin", password: "secret", "cf-turnstile-response": "fresh" }));
      expect(accepted.headers.get("location")).toBe("/");
      expect(authenticateUserMock).toHaveBeenCalledTimes(1);
      const [url, init] = siteverify.mock.calls.at(-1)!;
      expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
      expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({ secret: "secret", response: "fresh", remoteip: "127.0.0.1" });
    });

    it("keeps signing in with the password checks while Cloudflare cannot be reached", async () => {
      siteverify.mockRejectedValueOnce(new Error("connect ETIMEDOUT"));
      const response = await POST(makeLoginRequest({ username: "admin", password: "secret", "cf-turnstile-response": "token" }));
      expect(response.headers.get("location")).toBe("/");
      expect(authenticateUserMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("account name handling", () => {
    it("answers an over-long name like any wrong login without keeping state for it", async () => {
      const rate = await import("@/lib/rate-limit");
      const audit = await import("@/lib/audit/service");
      for (const length of [41, 300_000]) {
        const response = await POST(makeLoginRequest({ username: "x".repeat(length), password: "secret-pass" }));
        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toMatch(/^\/login\?error=invalid/);
      }
      expect(authenticateUserMock).not.toHaveBeenCalled();
      expect(rate.isAccountLockedAsync).not.toHaveBeenCalled();
      expect(rate.recordLoginFailureAsync).not.toHaveBeenCalled();
      expect(audit.auditSystemAction).not.toHaveBeenCalled();
    });

    it("answers a name holding U+0000 like any wrong login instead of failing in the database", async () => {
      const response = await POST(makeLoginRequest({ username: "adm\u0000in", password: "secret-pass" }));
      expect(response.headers.get("location")).toMatch(/^\/login\?error=invalid/);
      expect(authenticateUserMock).not.toHaveBeenCalled();
    });

    it("keys the lockout and the audit row on the trimmed name while authenticating the typed one", async () => {
      const rate = await import("@/lib/rate-limit");
      const audit = await import("@/lib/audit/service");
      authenticateUserMock.mockResolvedValueOnce(null);
      await POST(makeLoginRequest({ username: "  admin ", password: "wrong-pass" }));
      expect(rate.isAccountLockedAsync).toHaveBeenCalledWith("admin", "127.0.0.1");
      expect(rate.recordLoginFailureAsync).toHaveBeenCalledWith("admin", "127.0.0.1");
      expect(vi.mocked(audit.auditSystemAction).mock.calls.at(-1)?.[1]).toMatchObject({ username: "admin" });
    });
  });

  it("files a platform administrator's sign-in outside any customer's audit log, but a customer account's inside its own", async () => {
    const audit = await import("@/lib/audit/service");
    const preferences = { defaultPage: "/", dashboardWidgets: ["server-status"], notificationsEnabled: true, notificationSound: true, autoRefreshInterval: 30 };
    authenticateUserMock.mockResolvedValueOnce({ id: "u_a", username: "admin", roles: ["admin"], currentTeamId: "team_last_selected", mustChangePassword: false, preferences, twoFactorEnabled: false, hasTwoFactorSecret: false, credentialBinding });
    await POST(makeLoginRequest({ username: "admin", password: "right-pass-1" }));
    authenticateUserMock.mockResolvedValueOnce({ id: "u_c", username: "carol", roles: [], currentTeamId: "team_carol", mustChangePassword: false, preferences, twoFactorEnabled: false, hasTwoFactorSecret: false, credentialBinding });
    await POST(makeLoginRequest({ username: "carol", password: "right-pass-1" }));
    const okCalls = vi.mocked(audit.auditUserAction).mock.calls.filter((call) => call[1] === "auth.login_password_ok");
    expect(okCalls.map((call) => call[4])).toEqual([null, "team_carol"]);
  });

  it("uses the normal session TTL when remember login is not checked", async () => {
    process.env.AUTH_SESSION_TTL_SECONDS = "1234";

    const response = await POST(makeLoginRequest({ username: "admin", password: "secret", next: "/servers" }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/servers");
    expect(createSessionTokenMock).toHaveBeenCalledWith(expect.objectContaining({ userId: "u_1" }), { remember: false, credentialBinding });
    expect(response.headers.getSetCookie().join("\n")).toContain("Max-Age=1234");
  });

  it("extends session and csrf cookies when remember login is checked", async () => {
    process.env.AUTH_REMEMBER_SESSION_TTL_SECONDS = "2592000";

    const response = await POST(makeLoginRequest({ username: "admin", password: "secret", remember: "on" }));

    expect(createSessionTokenMock).toHaveBeenCalledWith(expect.objectContaining({ userId: "u_1" }), { remember: true, credentialBinding });
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toContain("test_session=session-token");
    expect(cookies).toContain("csrf_token=csrf-token");
    expect(cookies).toContain("Max-Age=2592000");
  });

  it("uses the user's default page when login has no explicit next target", async () => {
    authenticateUserMock.mockResolvedValueOnce({
      id: "u_1",
      username: "admin",
      roles: ["admin"],
      mustChangePassword: false,
      preferences: { defaultPage: "/files", dashboardWidgets: ["server-status"], notificationsEnabled: true, notificationSound: true, autoRefreshInterval: 30 },
      twoFactorEnabled: false,
      hasTwoFactorSecret: false,
    });

    const response = await POST(makeLoginRequest({ username: "admin", password: "secret" }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/files");
  });

  it("falls back to the dashboard when a saved default page is no longer permitted", async () => {
    authenticateUserMock.mockResolvedValueOnce({
      id: "u_1",
      username: "viewer",
      roles: ["viewer"],
      mustChangePassword: false,
      preferences: { defaultPage: "/docker", dashboardWidgets: ["server-status"], notificationsEnabled: true, notificationSound: true, autoRefreshInterval: 30 },
      twoFactorEnabled: false,
      hasTwoFactorSecret: false,
    });

    const response = await POST(makeLoginRequest({ username: "viewer", password: "secret" }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
  });

  it("carries remember login into the pending 2FA token", async () => {
    authenticateUserMock.mockResolvedValueOnce({
      id: "u_1",
      username: "admin",
      roles: ["admin"],
      mustChangePassword: false,
      preferences: { defaultPage: "/", dashboardWidgets: ["server-status"], notificationsEnabled: true, notificationSound: true, autoRefreshInterval: 30 },
      twoFactorEnabled: true,
      hasTwoFactorSecret: true,
      currentTeamId: null,
      credentialBinding,
    });

    const response = await POST(makeLoginRequest({ username: "admin", password: "secret", remember: "on" }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login/verify-2fa?next=%2F");
    expect(createPending2faTokenMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: "u_1",
      remember: true,
    }), { credentialBinding });
    expect(response.headers.getSetCookie().join("\n")).toContain("test_pending_2fa=pending-token");
  });

  it("sets Secure on session cookies when X-Forwarded-Proto is https behind Caddy", async () => {
    const response = await POST(
      new Request("http://127.0.0.1:3000/api/login", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-forwarded-proto": "https",
        },
        body: new URLSearchParams({ username: "admin", password: "secret", next: "/servers" }),
      }),
    );

    expect(response.status).toBe(303);
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toMatch(/test_session=session-token;[^\n]*Secure/i);
    expect(cookies).toMatch(/csrf_token=csrf-token;[^\n]*Secure/i);
  });

  it("rejects an oversized chunked login body before authentication", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_NON_FILE_FORM_BYTES + 1));
        controller.close();
      },
    });
    const request = new Request("https://console.example.test/api/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect(request.headers.get("content-length")).toBeNull();

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(authenticateUserMock).not.toHaveBeenCalled();
  });
});
