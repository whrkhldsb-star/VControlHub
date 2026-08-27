import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: { verifyTOTP: vi.fn(), userUpdateMany: vi.fn() },
}));

vi.mock("otplib", () => ({ verify: mocks.verifyTOTP }));
vi.mock("@/lib/db", () => ({
  prisma: { user: { updateMany: mocks.userUpdateMany } },
}));

const { verifyTwoFactorChallenge, isAcceptableTwoFactorCodeShape } = await import(
  "../two-factor-challenge"
);
const { createTwoFactorRecoveryCodes } = await import("../two-factor-recovery");

describe("isAcceptableTwoFactorCodeShape", () => {
  it("accepts either factor and nothing else", () => {
    expect(isAcceptableTwoFactorCodeShape("123456")).toBe(true);
    expect(isAcceptableTwoFactorCodeShape("ABCD-EFGH-JKLM")).toBe(true);
    expect(isAcceptableTwoFactorCodeShape("abcd efgh jklm")).toBe(true);
    expect(isAcceptableTwoFactorCodeShape("12345")).toBe(false);
    expect(isAcceptableTwoFactorCodeShape("1234567")).toBe(false);
    // I/O/0/1 are excluded from the recovery alphabet to avoid transcription errors.
    expect(isAcceptableTwoFactorCodeShape("ABCDEFGHJKL0")).toBe(false);
    expect(isAcceptableTwoFactorCodeShape("")).toBe(false);
  });
});

describe("verifyTwoFactorChallenge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("accepts an authenticator code without touching recovery codes", async () => {
    mocks.verifyTOTP.mockResolvedValue({ valid: true });
    const generated = createTwoFactorRecoveryCodes(3);

    const result = await verifyTwoFactorChallenge({
      userId: "u1",
      code: "123456",
      sealedSecret: "SEED",
      storedRecoveryCodes: generated.hashes,
    });

    expect(result).toEqual({ valid: true, usedRecoveryCode: false });
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
  });

  it("consumes exactly the matching recovery code when no authenticator code is given", async () => {
    mocks.verifyTOTP.mockResolvedValue({ valid: false });
    const generated = createTwoFactorRecoveryCodes(3);

    const result = await verifyTwoFactorChallenge({
      userId: "u1",
      code: generated.codes[1]!,
      sealedSecret: "SEED",
      storedRecoveryCodes: generated.hashes,
    });

    expect(result).toEqual({ valid: true, usedRecoveryCode: true });
    // CAS on the whole array: two concurrent uses of one code cannot both win.
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: { id: "u1", twoFactorRecoveryCodes: { equals: generated.hashes } },
      data: {
        twoFactorRecoveryCodes: [generated.hashes[0], generated.hashes[2]],
      },
    });
  });

  it("loses the race when another request already consumed the same code", async () => {
    mocks.verifyTOTP.mockResolvedValue({ valid: false });
    mocks.userUpdateMany.mockResolvedValue({ count: 0 });
    const generated = createTwoFactorRecoveryCodes(2);

    const result = await verifyTwoFactorChallenge({
      userId: "u1",
      code: generated.codes[0]!,
      sealedSecret: "SEED",
      storedRecoveryCodes: generated.hashes,
    });

    expect(result).toEqual({ valid: false, usedRecoveryCode: false });
  });

  it("rejects an unknown recovery code without a write", async () => {
    mocks.verifyTOTP.mockResolvedValue({ valid: false });
    const generated = createTwoFactorRecoveryCodes(2);

    const result = await verifyTwoFactorChallenge({
      userId: "u1",
      code: "AAAA-BBBB-CCCC",
      sealedSecret: "SEED",
      storedRecoveryCodes: generated.hashes,
    });

    expect(result).toEqual({ valid: false, usedRecoveryCode: false });
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
  });

  it("never asks otplib to verify a code that is not 6 digits", async () => {
    mocks.verifyTOTP.mockResolvedValue({ valid: true });
    const generated = createTwoFactorRecoveryCodes(1);

    await verifyTwoFactorChallenge({
      userId: "u1",
      code: generated.codes[0]!,
      sealedSecret: "SEED",
      storedRecoveryCodes: generated.hashes,
    });

    expect(mocks.verifyTOTP).not.toHaveBeenCalled();
  });
});
