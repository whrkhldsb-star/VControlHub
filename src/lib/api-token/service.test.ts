import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session";
import { AuthError, ForbiddenError, ValidationError } from "@/lib/errors";

const { mockPrisma, tx } = vi.hoisted(() => ({
  mockPrisma: {
    $transaction: vi.fn(),
    apiToken: { findMany: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    team: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
  tx: { $queryRaw: vi.fn(), user: { findUnique: vi.fn() }, apiToken: { create: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
const { createApiToken, hashApiToken, listApiTokens, verifyApiToken } = await import("./service");

const ownerAtAuthentication = {
  id: "u1", username: "alice", roles: [], status: "ACTIVE", mustChangePassword: false,
  passwordHash: "credential", sessionEpoch: 3,
  teamMembership: {
    teamId: "team_1", team: { deletedAt: null },
    identityTemplate: { permissions: ["api-token:manage", "health:read"] },
  },
};
async function authenticate(selectedTeamId = "team_1") {
  const cookie = await createSessionToken({
    userId: "u1", username: "alice", roles: [], currentTeamId: selectedTeamId, mustChangePassword: false,
  });
  return verifySessionToken(cookie);
}

describe("api token service", () => {
  let liveTeam: boolean;
  let adminGrant: boolean;
  let memberTeamId: string | null;
  let templatePermissions: string[];
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("AUTH_SESSION_TTL_SECONDS", "3600");
    liveTeam = true;
    adminGrant = false;
    memberTeamId = "team_1";
    templatePermissions = ["api-token:manage", "health:read"];
    mockPrisma.user.findUnique.mockResolvedValue(ownerAtAuthentication);
    mockPrisma.$transaction.mockImplementation((operation) => operation(tx));
    tx.user.findUnique.mockResolvedValue(ownerAtAuthentication);
    tx.$queryRaw.mockImplementation((strings: TemplateStringsArray, ...values: string[]) => {
      const sql = strings.join("?");
      if (sql.includes("FROM teams")) return liveTeam ? [{ id: values[0] }] : [];
      if (sql.includes('FROM "User"')) return [{ id: values[0] }];
      if (sql.includes('FROM "UserRole"')) return adminGrant && values[0] === "u1" ? [{ id: "role_admin" }] : [];
      if (sql.includes("FROM team_members")) {
        return values[0] === "u1" && values[1] === memberTeamId ? [{ permissions: templatePermissions }] : [];
      }
      throw new Error("Unexpected query: " + sql);
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("locks the issuer and live grants before inserting the hash and returning plaintext once", async () => {
    tx.apiToken.create.mockImplementation(({ data }) => ({
      id: "tok1", name: data.name, tokenPrefix: data.tokenPrefix, tokenSuffix: data.tokenSuffix,
      scopes: data.scopes, teamId: data.teamId,
    }));
    const session = await authenticate();
    const result = await createApiToken({ session, name: "cli", scopes: [" read ", "read", "health:read"] });
    expect(result.token).toMatch(/^whr_/);
    const { data, select } = tx.apiToken.create.mock.calls[0]![0];
    expect(data).toMatchObject({
      tokenHash: hashApiToken(result.token), tokenPrefix: result.token.slice(0, 8), tokenSuffix: result.token.slice(-6),
      scopes: ["read", "health:read"], teamId: "team_1", createdBy: "u1",
    });
    expect(JSON.stringify(data)).not.toContain(result.token);
    expect(select).not.toHaveProperty("tokenHash");
    expect(result.apiToken).not.toHaveProperty("tokenHash");
    const sql = tx.$queryRaw.mock.calls.map(([statement]) => statement.join("?").replace(/\s+/g, " ").trim());
    expect(sql[0]).toMatch(/FROM teams WHERE id = \? AND "deletedAt" IS NULL FOR SHARE/);
    expect(sql[1]).toMatch(/FROM "User" WHERE id = \? FOR UPDATE/);
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(tx.user.findUnique.mock.invocationCallOrder[0]!);
    expect(sql[2]).toContain('FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId"');
    expect(sql[2]).toContain(`WHERE ur."userId" = ? AND r.key = 'admin' FOR SHARE OF ur, r`);
    expect(sql[3]).toMatch(/member\."userId" = \? AND member\."teamId" = \? FOR SHARE OF member, template/);
    expect(tx.$queryRaw.mock.invocationCallOrder[3]).toBeLessThan(tx.apiToken.create.mock.invocationCallOrder[0]!);
  });

  it("rejects an unknown scope inside the transaction", async () => {
    const session = await authenticate();
    await expect(createApiToken({ session, name: "cli", scopes: ["read", "admin:everything"] })).rejects.toBeInstanceOf(ValidationError);
    expect(tx.apiToken.create).not.toHaveBeenCalled();
  });

  it.each([{ sessionEpoch: 4 }, { passwordHash: "replacement" }])("rejects a session invalidated after authentication: %o", async change => {
    const session = await authenticate();
    tx.user.findUnique.mockResolvedValue({ ...ownerAtAuthentication, ...change });
    await expect(createApiToken({ session, name: "cli" })).rejects.toBeInstanceOf(AuthError);
    expect(tx.apiToken.create).not.toHaveBeenCalled();
  });

  it.each([{ status: "DISABLED" }, { status: "PENDING_PASSWORD_RESET" }, { mustChangePassword: true }])(
    "rejects an account made unavailable after authentication: %o", async change => {
      const session = await authenticate();
      tx.user.findUnique.mockResolvedValue({ ...ownerAtAuthentication, ...change });
      await expect(createApiToken({ session, name: "cli" })).rejects.toBeInstanceOf(AuthError);
      expect(tx.apiToken.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    { revoked: "issuance permission", remaining: ["health:read"] },
    { revoked: "requested scope", remaining: ["api-token:manage"] },
  ])("revalidates the $revoked after authentication", async ({ remaining }) => {
    const session = await authenticate();
    templatePermissions = remaining;
    await expect(createApiToken({ session, name: "cli", scopes: ["health:read"] })).rejects.toBeInstanceOf(ForbiddenError);
    expect(tx.apiToken.create).not.toHaveBeenCalled();
  });

  it("binds issuance to the verified session's live customer", async () => {
    const session = await authenticate();
    memberTeamId = "team_2";
    await expect(createApiToken({ session, name: "cli" })).rejects.toBeInstanceOf(ForbiddenError);
    memberTeamId = "team_1";
    liveTeam = false;
    await expect(createApiToken({ session, name: "cli" })).rejects.toBeInstanceOf(ForbiddenError);
    mockPrisma.user.findUnique.mockResolvedValue({ ...ownerAtAuthentication, teamMembership: null });
    const withoutCustomer = await authenticate();
    await expect(createApiToken({ session: withoutCustomer, name: "cli" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(tx.apiToken.create).not.toHaveBeenCalled();
  });

  it("lets an administrator issue in the selected customer until the live admin role is removed", async () => {
    const admin = { ...ownerAtAuthentication, teamMembership: null, roles: [{ role: { key: "admin" } }] };
    mockPrisma.user.findUnique.mockResolvedValue(admin);
    mockPrisma.team.findUnique.mockResolvedValue({ id: "team_7", deletedAt: null });
    const session = await authenticate("team_7");
    adminGrant = true;
    tx.apiToken.create.mockResolvedValue({ id: "tok2" });
    await expect(createApiToken({ session, name: "ops" })).resolves.toMatchObject({ apiToken: { id: "tok2" } });
    adminGrant = false;
    await expect(createApiToken({ session, name: "ops" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(tx.apiToken.create).toHaveBeenCalledTimes(1);
  });
  it("bounds token list hydration newest-first for growing token history", async () => {
    mockPrisma.apiToken.findMany.mockResolvedValue([]);
    await listApiTokens("u1");
    expect(mockPrisma.apiToken.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { createdBy: "u1" },
      orderBy: { createdAt: "desc" },
      take: 200,
    }));
  });
  it("rejects expired, revoked, or owner-disabled tokens", async () => {
    mockPrisma.apiToken.findUnique.mockResolvedValueOnce({ id: "t1", createdBy: "u1", scopes: ["read"], revokedAt: new Date(), expiresAt: null, creator: { id: "u1", status: "ACTIVE" } });
    await expect(verifyApiToken("whr_bad")).resolves.toBeNull();
    mockPrisma.apiToken.findUnique.mockResolvedValueOnce({ id: "t2", createdBy: "u1", scopes: ["read"], revokedAt: null, expiresAt: new Date("2020-01-01"), creator: { id: "u1", status: "ACTIVE" } });
    await expect(verifyApiToken("whr_bad2")).resolves.toBeNull();
    mockPrisma.apiToken.findUnique.mockResolvedValueOnce({ id: "t3", createdBy: "u1", scopes: ["read"], revokedAt: null, expiresAt: null, creator: { id: "u1", status: "DISABLED" } });
    await expect(verifyApiToken("whr_disabled")).resolves.toBeNull();
    expect(mockPrisma.apiToken.update).not.toHaveBeenCalled();
  });

  it("throttles lastUsedAt writes when the token was used recently", async () => {
    const recent = new Date(Date.now() - 60_000);
    mockPrisma.apiToken.findUnique.mockResolvedValueOnce({
      id: "t-recent",
      createdBy: "u1",
      teamId: "team_1",
      scopes: ["read"],
      revokedAt: null,
      expiresAt: null,
      lastUsedAt: recent,
      creator: { id: "u1", status: "ACTIVE" },
    });
    await expect(verifyApiToken("whr_recent")).resolves.toEqual({
      userId: "u1",
      scopes: ["read"],
      tokenId: "t-recent",
      teamId: "team_1",
    });
    expect(mockPrisma.apiToken.update).not.toHaveBeenCalled();

    mockPrisma.apiToken.findUnique.mockResolvedValueOnce({
      id: "t-stale",
      createdBy: "u1",
      teamId: "team_1",
      scopes: ["read"],
      revokedAt: null,
      expiresAt: null,
      lastUsedAt: new Date(Date.now() - 10 * 60 * 1000),
      creator: { id: "u1", status: "ACTIVE" },
    });
    await expect(verifyApiToken("whr_stale")).resolves.toMatchObject({ tokenId: "t-stale" });
    expect(mockPrisma.apiToken.update).toHaveBeenCalledWith({
      where: { id: "t-stale" },
      data: { lastUsedAt: expect.any(Date) },
    });
  });
});
