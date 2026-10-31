// @vitest-environment node
import { randomUUID } from "node:crypto";
import { generate, generateSecret } from "otplib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { verifyTwoFactorChallenge } from "../two-factor-challenge";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("durable TOTP consumption", () => {
  const id = `totp-fix-${randomUUID()}`;
  const secret = generateSecret();
  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) throw new Error("Disposable database required");
    await prisma.user.create({ data: { id, username: id, passwordHash: "not-a-login-hash", status: "ACTIVE", twoFactorEnabled: true, twoFactorSecret: secret } });
  });
  afterAll(async () => { await prisma.user.deleteMany({ where: { id } }); await prisma.$disconnect(); });
  it("accepts exactly one concurrent attempt and rejects replay after module reload", async () => {
    const input = { userId: id, code: await generate({ secret }), sealedSecret: secret, storedRecoveryCodes: [] };
    const results = await Promise.all(Array.from({ length: 5 }, () => verifyTwoFactorChallenge(input)));
    expect(results.filter((r) => r.valid)).toHaveLength(1);
    vi.resetModules();
    const fresh = await import("../two-factor-challenge");
    expect((await fresh.verifyTwoFactorChallenge(input)).valid).toBe(false);
    const freshDb = await import("@/lib/db"); await freshDb.prisma.$disconnect();
  });
  it("rejects an otherwise valid code after the stored secret was replaced", async () => {
    await prisma.user.update({ where: { id }, data: { lastAcceptedTotpStep: null } });
    const oldSecret = generateSecret();
    expect((await verifyTwoFactorChallenge({ userId: id, code: await generate({ secret: oldSecret }), sealedSecret: oldSecret, storedRecoveryCodes: [] })).valid).toBe(false);
  });
});
