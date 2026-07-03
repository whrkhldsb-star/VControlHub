import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { authenticateUserMock, createSessionTokenMock, createPending2faTokenMock } = vi.hoisted(() => ({
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
  checkRateLimit: vi.fn(() => ({ allowed: true, retryAfterMs: 0 })),
  checkRateLimitAsync: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
  getClientIp: vi.fn(() => "127.0.0.1"),
  LOGIN_RATE_LIMIT: { windowMs: 1, max: 10 },
  LOGIN_SLOW_RATE_LIMIT: { windowMs: 1, max: 100 },
  isAccountLocked: vi.fn(() => ({ locked: false })),
  recordLoginFailure: vi.fn(() => ({ locked: false, failCount: 1 })),
  clearLoginFailure: vi.fn(),
}));
vi.mock("@/lib/auth/csrf", () => ({
  generateCsrfToken: () => "csrf-token",
  getCsrfCookieName: () => "csrf_token",
}));

import { POST } from "../route";

function makeLoginRequest(body: Record<string, string>) {
  return new Request("https://console.example.test/api/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}

describe("POST /api/login", () => {
  const oldEnv = { ...process.env };

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
      twoFactorSecret: null,
    });
  });

  afterEach(() => {
    process.env = oldEnv;
  });

  it("uses the normal session TTL when remember login is not checked", async () => {
    process.env.AUTH_SESSION_TTL_SECONDS = "1234";

    const response = await POST(makeLoginRequest({ username: "admin", password: "secret", next: "/servers" }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/servers");
    expect(createSessionTokenMock).toHaveBeenCalledWith(expect.objectContaining({ userId: "u_1" }), { remember: false });
    expect(response.headers.getSetCookie().join("\n")).toContain("Max-Age=1234");
  });

  it("extends session and csrf cookies when remember login is checked", async () => {
    process.env.AUTH_REMEMBER_SESSION_TTL_SECONDS = "2592000";

    const response = await POST(makeLoginRequest({ username: "admin", password: "secret", remember: "on" }));

    expect(createSessionTokenMock).toHaveBeenCalledWith(expect.objectContaining({ userId: "u_1" }), { remember: true });
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
      twoFactorSecret: null,
    });

    const response = await POST(makeLoginRequest({ username: "admin", password: "secret" }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/files");
  });
});
