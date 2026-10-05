// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiCatch } from "@/lib/http/api-error";
import type { SessionPayload } from "../session";
import { createSessionToken, getSessionCookieName, verifySessionToken } from "../session";
import { createTwoFactorEnrollmentToken } from "../two-factor-enrollment";
import { POST as enable } from "@/app/api/auth/2fa/enable/route";
import { POST as disable } from "@/app/api/auth/2fa/disable/route";
import { POST as regenerate } from "@/app/api/auth/2fa/recovery-codes/route";

const state = vi.hoisted(() => ({ session: null as SessionPayload | null }));
// The route guard and clock-dependent TOTP verification are covered separately.
// Exercise the actual route mutations, cookie minting and PostgreSQL locks here.
vi.mock("otplib", () => ({ verify: async () => ({ valid: true }) }));
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
    body: JSON.stringify({ code: "123456", enrollmentToken: createTwoFactorEnrollmentToken({ userId: id, secret }) }),
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
      passwordHash: originalHash, sessionEpoch: 4, status: "ACTIVE",
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
