import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

import {
  createTwoFactorRecoveryCodes,
  findMatchingTwoFactorRecoveryCode,
  normalizeTwoFactorRecoveryCode,
} from "@/lib/auth/two-factor-recovery";

describe("two-factor recovery codes", () => {
  it("retains legacy HMAC verification without rewriting or exposing codes", () => {
    vi.stubEnv("AUTH_SESSION_SECRET", "legacy-test-key");
    const hash = createHmac("sha256", "legacy-test-key").update("vcontrolhub:2fa-recovery:ABCDEFGHJKLM").digest("base64url");
    try { expect(findMatchingTwoFactorRecoveryCode("ABCD-EFGH-JKLM", [hash])).toBe(hash); }
    finally { vi.unstubAllEnvs(); }
  });
  it("keeps new recovery codes valid after migrating to another session signing secret", () => {
    vi.stubEnv("AUTH_SESSION_SECRET", "source-test-signing-key");
    const generated = createTwoFactorRecoveryCodes(1);
    vi.stubEnv("AUTH_SESSION_SECRET", "target-test-signing-key");
    try { expect(findMatchingTwoFactorRecoveryCode(generated.codes[0]!, generated.hashes)).toBe(generated.hashes[0]); }
    finally { vi.unstubAllEnvs(); }
  });
  it("generates formatted, unique, one-way recovery codes", () => {
    const generated = createTwoFactorRecoveryCodes();

    expect(generated.codes).toHaveLength(10);
    expect(new Set(generated.codes).size).toBe(10);
    expect(generated.codes.every((code) => /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2}$/.test(code))).toBe(true);
    expect(generated.hashes).toHaveLength(10);
    expect(generated.hashes).not.toContain(generated.codes[0]);
  });

  it("normalizes separators and consumes only a matching stored fingerprint", () => {
    const generated = createTwoFactorRecoveryCodes(1);
    const entered = generated.codes[0]!.toLowerCase().replaceAll("-", " ");

    expect(normalizeTwoFactorRecoveryCode(entered)).toBe(generated.codes[0]!.replaceAll("-", ""));
    expect(findMatchingTwoFactorRecoveryCode(entered, generated.hashes)).toBe(generated.hashes[0]);
    expect(findMatchingTwoFactorRecoveryCode("AAAA-BBBB-CCCC", generated.hashes)).toBeNull();
    expect(
      normalizeTwoFactorRecoveryCode(
        `${generated.codes[0]!.slice(0, 4)}!${generated.codes[0]!.slice(4)}`,
      ),
    ).toBeNull();
  });
});
