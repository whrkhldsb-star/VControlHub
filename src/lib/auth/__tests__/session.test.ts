import { afterEach, describe, expect, it, vi } from "vitest";

import {
  verifySessionToken,
  createSessionToken,
  createPending2faToken,
  verifyPending2faToken,
} from "@/lib/auth/session";
import { prisma } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    rolePermission: {
      findMany: vi.fn(),
    },
  },
}));

/**
 * Rebuild a token in the pre-fingerprint format: same envelope and same HMAC,
 * simply without `cfp`. Mirrors what a cookie issued by the previous release
 * looks like, so the fail-closed behaviour is tested against the real shape.
 */
async function createLegacySessionTokenWithoutFingerprint(): Promise<string> {
  const { createHmac } = await import("node:crypto");
  const now = Date.now();
  const envelope = {
    userId: "u_1",
    username: "admin",
    roles: ["admin"],
    mustChangePassword: false,
    currentTeamId: null,
    iss: "vcontrolhub",
    aud: "vcontrolhub-console",
    iat: now,
    exp: now + 7 * 24 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(envelope)).toString("base64url");
  const signature = createHmac("sha256", "dev-only-session-secret-change-me")
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

describe("session auth helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("uses a portable cookie name derived from APP_SLUG when not explicitly configured", async () => {
    vi.stubEnv("APP_SLUG", "my-console");
    vi.stubEnv("AUTH_SESSION_COOKIE_NAME", "");
    vi.resetModules();

    const session = await import("@/lib/auth/session");

    expect(session.getSessionCookieName()).toBe("my-console_session");
  });

  it("allows the session cookie name to be explicitly configured", async () => {
    vi.stubEnv("APP_SLUG", "my-console");
    vi.stubEnv("AUTH_SESSION_COOKIE_NAME", "custom_session");
    vi.resetModules();

    const session = await import("@/lib/auth/session");

    expect(session.getSessionCookieName()).toBe("custom_session");
  });

	it("reads the configured cookie name after an early module import", async () => {
		vi.stubEnv("AUTH_SESSION_COOKIE_NAME", "");
		vi.resetModules();
		const session = await import("@/lib/auth/session");

		vi.stubEnv("AUTH_SESSION_COOKIE_NAME", "late-loaded-session");

		expect(session.getSessionCookieName()).toBe("late-loaded-session");
	});

  it("round-trips a signed session token", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "u_1",
      username: "admin",
      status: "ACTIVE",
      mustChangePassword: false,
      currentTeamId: null,
      passwordHash: "$2b$10$originalhash",
      roles: [{ role: { key: "viewer" } }],
    } as any);
    const token = await createSessionToken({
      userId: "u_1",
      username: "admin",
      roles: ["admin"],
      mustChangePassword: true,
      currentTeamId: null,
    });

    await expect(verifySessionToken(token)).resolves.toMatchObject({
      userId: "u_1",
      username: "admin",
      roles: ["viewer"],
      mustChangePassword: false,
      currentTeamId: null,
    });
  });

  it("resolves the direct grants of a custom role into session.permissions", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "u_1",
      username: "alice",
      status: "ACTIVE",
      mustChangePassword: false,
      currentTeamId: null,
      passwordHash: "$2b$10$originalhash",
      roles: [{ role: { key: "viewer" } }, { role: { key: "user:u_1:custom" } }],
    } as any);
    vi.mocked(prisma.rolePermission.findMany).mockResolvedValueOnce([
      { permission: { key: "docker:manage" } },
    ] as any);
    const token = await createSessionToken({
      userId: "u_1",
      username: "alice",
      roles: ["viewer"],
      mustChangePassword: false,
      currentTeamId: null,
    });

    const session = await verifySessionToken(token);

    // Without this the permission panel's saved grants were persisted and shown
    // back to the admin, but never honoured by sessionHasPermission.
    expect(session.permissions).toContain("docker:manage");
    expect(session.permissions).toContain("storage:read");
    // The synthetic per-user role is not a RoleKey and stays out of the list.
    expect(session.roles).toEqual(["viewer"]);
  });

  it("rejects signed sessions for disabled users", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "u_1",
      username: "admin",
      status: "DISABLED",
      mustChangePassword: false,
      currentTeamId: null,
      passwordHash: "$2b$10$originalhash",
      roles: [{ role: { key: "admin" } }],
    } as any);
    const token = await createSessionToken({ userId: "u_1", username: "admin", roles: ["admin"], mustChangePassword: false, currentTeamId: null });

    await expect(verifySessionToken(token)).rejects.toThrow("disabled");
  });

  it("invalidates a session once the account's password has changed", async () => {
    const row = {
      id: "u_1",
      username: "admin",
      status: "ACTIVE",
      mustChangePassword: false,
      currentTeamId: null,
      passwordHash: "$2b$10$originalhash",
      roles: [{ role: { key: "admin" } }],
    };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(row as any);

    const token = await createSessionToken({
      userId: "u_1",
      username: "admin",
      roles: ["admin"],
      mustChangePassword: false,
      currentTeamId: null,
    });
    // Still valid against the password it was minted for.
    await expect(verifySessionToken(token)).resolves.toMatchObject({ userId: "u_1" });

    // changePassword rewrites passwordHash — every cookie carrying the old
    // fingerprint must stop working, which is the whole point when the reason for
    // the change is "someone else knows my old password".
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...row,
      passwordHash: "$2b$10$rotatedhash",
    } as any);

    await expect(verifySessionToken(token)).rejects.toThrow(/credentials have changed/i);
  });

  it("rejects a legacy token that carries no credential fingerprint", async () => {
    // Tokens minted before this check existed have no `cfp`. Honouring them would
    // keep the hole open for the rest of their TTL (up to 30d for remember-me),
    // so the check fails closed and those users re-login once.
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "u_1",
      username: "admin",
      status: "ACTIVE",
      mustChangePassword: false,
      currentTeamId: null,
      passwordHash: "$2b$10$originalhash",
      roles: [{ role: { key: "admin" } }],
    } as any);

    const legacy = await createLegacySessionTokenWithoutFingerprint();

    await expect(verifySessionToken(legacy)).rejects.toThrow(/credentials have changed/i);
  });

  it("round-trips a pending 2FA token and never accepts it as a full session", async () => {
    const pending = await createPending2faToken({
      userId: "u_1",
      username: "admin",
      roles: ["admin"],
      mustChangePassword: false,
      currentTeamId: "team_1",
      remember: true,
    });

    await expect(verifyPending2faToken(pending)).resolves.toMatchObject({
      userId: "u_1",
      username: "admin",
      roles: ["admin"],
      mustChangePassword: false,
      currentTeamId: "team_1",
      remember: true,
    });

    // Cookie-swap attack: present pending-2FA token under the session cookie name.
    await expect(verifySessionToken(pending)).rejects.toThrow(/audience|Pending 2FA/i);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
