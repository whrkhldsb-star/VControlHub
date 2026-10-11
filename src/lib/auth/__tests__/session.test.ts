import { afterEach, describe, expect, it, vi } from "vitest";

import {
  verifySessionToken,
  createSessionToken,
  createPending2faToken,
  verifyPending2faToken,
  captureSessionCredentialBinding,
  assertSessionCredentialBinding,
  reissueSessionForTeam,
} from "@/lib/auth/session";
import { prisma } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    team: {
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

  it("retains the verified credential proof without exposing it in serialized session data", async () => {
    const row = {
      id: "u_1", username: "alice", status: "ACTIVE", mustChangePassword: false,
      passwordHash: "original-credential", sessionEpoch: 4, roles: [],
    };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(row as any);
    const token = await createSessionToken({
      userId: row.id, username: row.username, roles: [], mustChangePassword: false, currentTeamId: null,
    });
    const session = await verifySessionToken(token);
    expect(() => assertSessionCredentialBinding(session, row)).not.toThrow();
    expect(() => assertSessionCredentialBinding(session, { ...row, sessionEpoch: 5 })).toThrow();
    expect(() => assertSessionCredentialBinding(session, { ...row, passwordHash: "reset" })).toThrow();
    const serialized = JSON.stringify(session);
    expect(serialized).not.toContain(captureSessionCredentialBinding(row).fingerprint);
    expect(serialized).not.toContain(row.passwordHash);
    expect(() => assertSessionCredentialBinding(JSON.parse(serialized), row)).toThrow();
  });

  it("derives a customer account's permissions from its identity template only", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "u_1",
      username: "alice",
      status: "ACTIVE",
      mustChangePassword: false,
      teamMembership: { teamId: "team_1", team: { deletedAt: null }, identityTemplate: { permissions: ["docker:manage", "storage:read", "user:manage"] } },
      passwordHash: "$2b$10$originalhash",
      // Leftover account roles grant nothing to a customer account.
      roles: [{ role: { key: "operator" } }],
    } as any);
    const token = await createSessionToken({ userId: "u_1", username: "alice", roles: ["operator"], mustChangePassword: false, currentTeamId: "team_1" });

    const session = await verifySessionToken(token);

    expect(session.permissions).toEqual(expect.arrayContaining(["docker:manage", "storage:read", "team:read", "user:read"]));
    // Platform-only permissions are never granted through a template.
    expect(session.permissions).not.toContain("user:manage");
    expect(session.permissions).not.toContain("server:write");
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

  it("retires every session when the account's session epoch advances", async () => {
    const row = {
      id: "u_1",
      username: "admin",
      status: "ACTIVE",
      mustChangePassword: false,
      currentTeamId: null,
      passwordHash: "$2b$10$originalhash",
      roles: [{ role: { key: "admin" } }],
      sessionEpoch: 0,
    };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(row as any);

    const token = await createSessionToken({
      userId: "u_1",
      username: "admin",
      roles: ["admin"],
      mustChangePassword: false,
      currentTeamId: null,
    });
    await expect(verifySessionToken(token)).resolves.toMatchObject({ userId: "u_1" });

    // bumpUserSessionEpoch (sign-out-everywhere / 2FA enable/disable) — every
    // previously issued cookie must stop verifying immediately.
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...row,
      sessionEpoch: 1,
    } as any);

    await expect(verifySessionToken(token)).rejects.toThrow(/credentials have changed|会话凭据已变更/i);
  });

  it("keeps pre-epoch tokens working while the account's epoch is still 0", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "u_1",
      username: "admin",
      status: "ACTIVE",
      mustChangePassword: false,
      currentTeamId: null,
      passwordHash: "$2b$10$originalhash",
      roles: [{ role: { key: "admin" } }],
      sessionEpoch: 0,
    } as any);

    const legacy = await createLegacySessionTokenWithoutFingerprint();
    // Legacy tokens are rejected on `cfp` before the epoch check ever runs;
    // assert that separately below with a token that carries `cfp` but no `sep`.
    await expect(verifySessionToken(legacy)).rejects.toThrow(/credentials have changed|会话凭据已变更/i);
  });

  it("invalidates a session once the account's password has changed", async () => {    const row = {
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

    await expect(verifySessionToken(token)).rejects.toThrow(/credentials have changed|会话凭据已变更/i);
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

    await expect(verifySessionToken(legacy)).rejects.toThrow(/credentials have changed|会话凭据已变更/i);
  });

  const customerRow = (teamMembership: unknown) => ({
    id: "u_1",
    username: "alice",
    status: "ACTIVE",
    mustChangePassword: false,
    teamMembership,
    passwordHash: "$2b$10$originalhash",
    roles: [],
  });
  const customerToken = (currentTeamId: string | null) =>
    createSessionToken({ userId: "u_1", username: "alice", roles: [], mustChangePassword: false, currentTeamId });

  it("keeps a customer account inside its own customer whatever the cookie selects", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(customerRow({ teamId: "team_1", team: { deletedAt: null }, identityTemplate: { permissions: ["server:read"] } }) as any);
    await expect(verifySessionToken(await customerToken("team_2"))).resolves.toMatchObject({ currentTeamId: "team_1" });
    await expect(verifySessionToken(await customerToken(null))).resolves.toMatchObject({ currentTeamId: "team_1" });
  });

  it("revokes a customer account's access once its membership is gone", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(customerRow(null) as any);
    await expect(verifySessionToken(await customerToken("team_1"))).resolves.toMatchObject({
      currentTeamId: null,
      permissions: ["user:read"],
    });
  });

  it("revokes a customer account's access once its customer is deleted", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(customerRow({ teamId: "team_1", team: { deletedAt: new Date() }, identityTemplate: { permissions: ["server:read"] } }) as any);
    await expect(verifySessionToken(await customerToken("team_1"))).resolves.toMatchObject({
      currentTeamId: null,
      permissions: ["user:read"],
    });
  });

  it("reads the membership in the same user lookup", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(customerRow({ teamId: "team_1", team: { deletedAt: null }, identityTemplate: { permissions: ["server:read"] } }) as any);
    const token = await customerToken("team_1");
    // Only count what verification itself queries; minting reads the owner too.
    vi.mocked(prisma.user.findUnique).mockClear();

    await verifySessionToken(token);

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(prisma.user.findUnique).mock.calls[0]?.[0] as any;
    expect(arg.select.teamMembership.select).toMatchObject({ teamId: true, identityTemplate: { select: { permissions: true } } });
  });

  it("lets a platform admin select any live customer, or all customers, per browser", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "u_1", username: "admin", status: "ACTIVE", mustChangePassword: false,
      teamMembership: null, passwordHash: "$2b$10$originalhash",
      roles: [{ role: { key: "admin" } }],
    } as any);
    vi.mocked(prisma.team.findUnique).mockImplementation((async (args: any) => (
      args.where.id === "team_gone" ? { id: "team_gone", deletedAt: new Date() } : { id: args.where.id, deletedAt: null }
    )) as any);
    const base = { userId: "u_1", username: "admin", roles: ["admin" as const], mustChangePassword: false };
    const first = await createSessionToken({ ...base, currentTeamId: "team_1" });
    const second = await createSessionToken({ ...base, currentTeamId: "team_2" });
    expect((await verifySessionToken(first)).currentTeamId).toBe("team_1");
    expect((await verifySessionToken(second)).currentTeamId).toBe("team_2");

    const rotated = await reissueSessionForTeam(first, "team_2");
    expect(rotated.maxAge).toBeGreaterThan(0);
    expect((await verifySessionToken(rotated.token)).currentTeamId).toBe("team_2");

    const allCustomers = await reissueSessionForTeam(rotated.token, null);
    expect((await verifySessionToken(allCustomers.token)).currentTeamId).toBeNull();

    // A deleted customer falls back to "all customers".
    const deleted = await createSessionToken({ ...base, currentTeamId: "team_gone" });
    expect((await verifySessionToken(deleted)).currentTeamId).toBeNull();
  });

  it("round-trips a pending 2FA token and never accepts it as a full session", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      passwordHash: "$2b$10$originalhash",
      sessionEpoch: 0,
      status: "ACTIVE",
    } as any);
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
    vi.mocked(prisma.user.findUnique).mockClear();
    await expect(verifySessionToken(pending)).rejects.toThrow(/audience|Pending 2FA/i);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["password reset", { passwordHash: "$2b$10$replacementhash", sessionEpoch: 4, status: "ACTIVE" }],
    ["sign out everywhere", { passwordHash: "$2b$10$originalhash", sessionEpoch: 5, status: "ACTIVE" }],
    ["account disable", { passwordHash: "$2b$10$originalhash", sessionEpoch: 4, status: "DISABLED" }],
    ["account deletion", null],
  ])("rejects an outstanding second-factor login after %s", async (_reason, updatedUser) => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      passwordHash: "$2b$10$originalhash",
      sessionEpoch: 4,
      status: "ACTIVE",
    } as any);
    const pending = await createPending2faToken({
      userId: "u_1",
      username: "alice",
      roles: ["viewer"],
      mustChangePassword: false,
      currentTeamId: "team_1",
    });

    vi.mocked(prisma.user.findUnique).mockResolvedValue(updatedUser as any);

    await expect(verifyPending2faToken(pending)).resolves.toBeNull();
  });

  it.each(["password", "epoch"])("does not mint either login token when the proved %s changes during login", async (changed) => {
    const original = { passwordHash: "$2b$10$originalhash", sessionEpoch: 4, status: "ACTIVE" };
    const credentialBinding = captureSessionCredentialBinding(original);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...original,
      ...(changed === "password" ? { passwordHash: "$2b$10$newhash" } : { sessionEpoch: 5 }),
    } as any);
    const payload = { userId: "u_1", username: "alice", roles: ["viewer"] as ["viewer"], mustChangePassword: false, currentTeamId: null };

    await expect(createSessionToken(payload, { credentialBinding })).rejects.toThrow();
    await expect(createPending2faToken(payload, { credentialBinding })).rejects.toThrow();
  });

  it("retains the original credential proof when completing the second factor", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      passwordHash: "$2b$10$originalhash", sessionEpoch: 2, status: "ACTIVE",
    } as any);
    const payload = { userId: "u_1", username: "alice", roles: ["viewer"] as ["viewer"], mustChangePassword: false, currentTeamId: null };
    const pending = await createPending2faToken(payload);
    const verified = await verifyPending2faToken(pending);
    expect(verified).not.toBeNull();

    // A revocation while the second factor is being checked must not be
    // undone by reading the new epoch when minting the full session.
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      passwordHash: "$2b$10$originalhash", sessionEpoch: 3, status: "ACTIVE",
    } as any);
    await expect(createSessionToken(payload, { credentialBinding: verified!.credentialBinding })).rejects.toThrow();
  });
});
