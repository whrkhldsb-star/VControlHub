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
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u_1",
      username: "admin",
      status: "ACTIVE",
      mustChangePassword: false,
      currentTeamId: null,
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
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u_1",
      username: "alice",
      status: "ACTIVE",
      mustChangePassword: false,
      currentTeamId: null,
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
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u_1",
      username: "admin",
      status: "DISABLED",
      mustChangePassword: false,
      currentTeamId: null,
      roles: [{ role: { key: "admin" } }],
    } as any);
    const token = await createSessionToken({ userId: "u_1", username: "admin", roles: ["admin"], mustChangePassword: false, currentTeamId: null });

    await expect(verifySessionToken(token)).rejects.toThrow("disabled");
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
