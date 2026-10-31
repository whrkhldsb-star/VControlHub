import { describe, expect, it, vi } from "vitest";
import { generate, generateSecret } from "otplib";

vi.mock("@/lib/db", () => {
  const spent = new Map<string, number>();
  return { prisma: { user: { updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: { lastAcceptedTotpStep: number } }) => {
    if ((spent.get(where.id) ?? -1) >= data.lastAcceptedTotpStep) return { count: 0 };
    spent.set(where.id, data.lastAcceptedTotpStep);
    return { count: 1 };
  }) } } };
});
vi.mock("../two-factor-secret", () => ({ openTwoFactorSecret: (sealed: string) => sealed }));

const { verifyTwoFactorChallenge } = await import("../two-factor-challenge");

describe("authenticator codes are single use", () => {
  it("accepts a code once and refuses the same code again within its window", async () => {
    const secret = generateSecret();
    const code = await generate({ secret });
    const attempt = (userId: string) =>
      verifyTwoFactorChallenge({ userId, code, sealedSecret: secret, storedRecoveryCodes: [] });

    expect((await attempt("replay-user")).valid).toBe(true);
    // Seen over a shoulder or in a log, the same code must not work a second time.
    expect((await attempt("replay-user")).valid).toBe(false);
    // The record is per account: the same code (same seed) for another account is a different user's problem.
    expect((await attempt("another-user")).valid).toBe(true);
  });
});
