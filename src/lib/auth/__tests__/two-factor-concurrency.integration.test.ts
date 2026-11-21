// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiCatch } from "@/lib/http/api-error";
import type { SessionPayload } from "../session";
import { captureSessionCredentialBinding, createSessionToken, getSessionCookieName, verifySessionToken } from "../session";
import { createTwoFactorEnrollmentToken } from "../two-factor-enrollment";
import { POST as enable } from "@/app/api/auth/2fa/enable/route";
import { POST as disable } from "@/app/api/auth/2fa/disable/route";
import { POST as regenerate } from "@/app/api/auth/2fa/recovery-codes/route";

const state = vi.hoisted(() => ({ session: null as SessionPayload | null }));
// The route guard and clock-dependent TOTP verification are covered separately.
// Exercise the actual route mutations, cookie minting and PostgreSQL locks here.
vi.mock("otplib", () => ({ verify: async () => ({ valid: true, timeStep: 12345678 }) }));
vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: async (
    request: Request,
    _options: unknown,
    handler: (context: { session: SessionPayload; body: unknown }) => Promise<Response>,
  ) => {
    try {
      return await handler({
        session: state.session!,
        body: await request.json(),
      });
    } catch (error) {
      return apiCatch(error);
    }
  },
}));

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("two-factor credential mutations under PostgreSQL concurrency", () => {
  const id = `two-factor-audit-${randomUUID()}`;
  const originalHash = "isolated-credential-fingerprint";
  let ready = false;
  const request = (secret = "JBSWY3DPEHPK3PXP") => new Request("http://localhost/api/auth/2fa/enable", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "123456", enrollmentToken: createTwoFactorEnrollmentToken({ userId: id, secret, binding: captureSessionCredentialBinding({ passwordHash: originalHash, sessionEpoch: 4 }) }) }),
  });

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("Two-factor integration requires an isolated loopback audit/test database");
    }
    await prisma.user.create({ data: { id, username: id, passwordHash: originalHash, sessionEpoch: 4, status: "ACTIVE" } });
    ready = true;
  });
  beforeEach(async () => {
    await prisma.user.update({ where: { id }, data: {
      passwordHash: originalHash, sessionEpoch: 4, status: "ACTIVE", lastAcceptedTotpStep: null,
      twoFactorEnabled: false, twoFactorSecret: null, twoFactorRecoveryCodes: Prisma.DbNull,
    } });
    const token = await createSessionToken({ userId: id, username: id, roles: [], mustChangePassword: false, currentTeamId: null });
    state.session = await verifySessionToken(token);
  });
  afterAll(async () => {
    if (ready) {
      await prisma.auditLog.deleteMany({ where: { actorId: id } });
      await prisma.user.delete({ where: { id } });
    }
    await prisma.$disconnect();
  });

  async function holdUserLock(mutate?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    let release!: () => void;
    let acquired!: (pid: number) => void;
    const unlocked = new Promise<void>((resolve) => { release = resolve; });
    const locked = new Promise<number>((resolve) => { acquired = resolve; });
    const transaction = prisma.$transaction(async (tx) => {
      const processes = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
      await mutate?.(tx);
      acquired(processes[0]!.pid);
      await unlocked;
    }, { timeout: 15_000 });
    return { blocker: await Promise.race([locked, transaction.then(() => { throw new Error("Lock ended before acquisition"); })]), release: async () => { release(); await transaction; } };
  }

  async function waitForWriters(blocker: number, minimum: number) {
    await vi.waitFor(async () => {
      const waiters = await prisma.$queryRaw<Array<{ waiting: number }>>`
        WITH RECURSIVE blocked AS (
          SELECT a.pid FROM pg_stat_activity a WHERE ${blocker} = ANY(pg_blocking_pids(a.pid))
          UNION
          SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))
        ) SELECT count(*)::int AS waiting FROM blocked
      `;
      expect(waiters[0]!.waiting).toBeGreaterThanOrEqual(minimum);
    }, { timeout: 8_000, interval: 25 });
  }

  it("lets only one concurrent enrollment install a factor and refresh its session", async () => {
    const lock = await holdUserLock();
    const responses = Promise.all([enable(request()), enable(request("GEZDGNBVGY3TQOJQ"))]);
    try {
      await waitForWriters(lock.blocker, 2);
    } finally {
      await lock.release();
    }
    const results = await responses;
    expect(results.map((response) => response.status).sort()).toEqual([200, 401]);
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user.sessionEpoch).toBe(5);
    expect(user.twoFactorEnabled).toBe(true);
    const response = results.find((response) => response.status === 200)!;
    expect(response).toBeInstanceOf(NextResponse);
    const cookie = (response as NextResponse).cookies.get(getSessionCookieName());
    expect(cookie).toBeDefined();
    await expect(verifySessionToken(cookie!.value)).resolves.toMatchObject({ userId: id });
  }, 20_000);

  it.each([
    ["enable", enable, false], ["disable", disable, true], ["regenerate recovery codes", regenerate, true],
  ] as const)("does not %s after a concurrent administrator credential reset", async (_name, mutate, enabled) => {
    if (enabled) await prisma.user.update({ where: { id }, data: { twoFactorEnabled: true, twoFactorSecret: "JBSWY3DPEHPK3PXP" } });
    const lock = await holdUserLock((tx) => tx.user.update({ where: { id }, data: { passwordHash: "administrator-reset", sessionEpoch: { increment: 1 } } }));
    const response = mutate(request());
    try {
      await waitForWriters(lock.blocker, 1);
    } finally {
      await lock.release();
    }
    const result = await response;
    expect(result.status).toBe(401);
    expect(result.headers.get("set-cookie")).toBeNull();
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user.passwordHash).toBe("administrator-reset");
    expect(user.sessionEpoch).toBe(5);
    expect(user.twoFactorEnabled).toBe(enabled);
    expect(user.twoFactorRecoveryCodes).toBeNull();
  }, 20_000);

  it("revokes old sessions when recovery credentials are replaced", async () => {
    await prisma.user.update({ where: { id }, data: { twoFactorEnabled: true, twoFactorSecret: "JBSWY3DPEHPK3PXP" } });
    const token = await createSessionToken({ userId: id, username: id, roles: [], mustChangePassword: false, currentTeamId: null });
    const result = await regenerate(request());
    expect(result.status).toBe(200);
    await expect(verifySessionToken(token)).rejects.toThrow();
    expect(result).toBeInstanceOf(NextResponse);
    const cookie = (result as NextResponse).cookies.get(getSessionCookieName());
    expect(cookie).toBeDefined();
    await expect(verifySessionToken(cookie!.value)).resolves.toMatchObject({ userId: id });
  });

  it.each(["admin", "customer"])("files all three %s security changes under the account and retires the old enrollment", async (account) => {
    const teamId = id + "-" + account;
    const fixtureRole = id + "-admin-role";
    await prisma.team.create({ data: { id: teamId, name: teamId, slug: teamId } });
    try {
      if (account === "admin") {
        const role = await prisma.role.upsert({ where: { key: "admin" }, update: {}, create: { id: fixtureRole, key: "admin", name: "Administrator" } });
        await prisma.userRole.create({ data: { userId: id, roleId: role.id } });
      } else {
        await prisma.identityTemplate.create({ data: { id: teamId, name: teamId, permissions: [] } });
        await prisma.teamMember.create({ data: { userId: id, teamId, identityTemplateId: teamId } });
      }
      await prisma.auditLog.deleteMany({ where: { actorId: id } });
      state.session = await verifySessionToken(await createSessionToken({ ...state.session!, currentTeamId: teamId }));
      expect(state.session.currentTeamId).toBe(teamId);
      const original = request();
      const enabled = await enable(original.clone());
      const readRotation = async (response: Response) => {
        expect(response.status).toBe(200);
        const cookie = (response as NextResponse).cookies.get(getSessionCookieName());
        state.session = await verifySessionToken(cookie!.value);
        return response.json();
      };
      const proof = (code: string) => new Request("http://localhost/api/auth/2fa", {
        method: "POST", body: JSON.stringify({ code }),
      });
      const first = await readRotation(enabled);
      const second = await readRotation(await regenerate(proof(first.recoveryCodes[0])));
      await readRotation(await disable(proof(second.recoveryCodes[0])));
      expect((await enable(original)).status).toBe(400);
      expect((await prisma.user.findUniqueOrThrow({ where: { id } })).twoFactorEnabled).toBe(false);
      const events = await prisma.auditLog.findMany({ where: { actorId: id }, orderBy: { action: "asc" }, select: { action: true, teamId: true } });
      expect(events).toEqual(["auth.2fa.disable", "auth.2fa.enable", "auth.2fa.recovery_codes_regenerated"]
        .map(action => ({ action, teamId: account === "admin" ? null : teamId })));
    } finally {
      await prisma.userRole.deleteMany({ where: { userId: id } });
      await prisma.role.deleteMany({ where: { id: fixtureRole, users: { none: {} } } });
      await prisma.teamMember.deleteMany({ where: { userId: id } });
      await prisma.identityTemplate.deleteMany({ where: { id: teamId } });
      await prisma.team.delete({ where: { id: teamId } });
    }
  });

  it.each([
    ["enable", enable, false], ["disable", disable, true], ["regenerate recovery codes", regenerate, true],
  ] as const)("does not %s when revocation lands after the guard but before the credential read", async (_name, mutate, enabled) => {
    // The guard already verified state.session. Reading current credentials
    // below must not turn that revoked session into proof of the newer epoch.
    await prisma.user.update({ where: { id }, data: {
      twoFactorEnabled: enabled,
      twoFactorSecret: enabled ? "JBSWY3DPEHPK3PXP" : null,
      sessionEpoch: { increment: 1 },
    } });
    const response = await mutate(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user.sessionEpoch).toBe(5);
    expect(user.twoFactorEnabled).toBe(enabled);
    expect(user.twoFactorRecoveryCodes).toBeNull();
  });
});
