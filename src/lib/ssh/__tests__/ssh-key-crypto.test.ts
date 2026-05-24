import { describe, expect, it } from "vitest";

import {
  decryptServerPassword,
  decryptSshPrivateKey,
  encryptServerPassword,
  encryptSshPrivateKey,
  isEncryptedServerPassword,
} from "@/lib/ssh/ssh-key-crypto";

const SAMPLE_PRIVATE_KEY = "sample-openssh-private-key-for-crypto-test";

describe("SSH credential crypto helpers", () => {
  it("round-trips SSH private keys while preserving legacy plain text reads", () => {
    const encrypted = encryptSshPrivateKey(SAMPLE_PRIVATE_KEY);

    expect(encrypted).not.toBe(SAMPLE_PRIVATE_KEY);
    expect(decryptSshPrivateKey(encrypted)).toBe(SAMPLE_PRIVATE_KEY);
    expect(decryptSshPrivateKey(SAMPLE_PRIVATE_KEY)).toBe(SAMPLE_PRIVATE_KEY);
  });

  it("round-trips server passwords with an explicit version prefix", () => {
    const encrypted = encryptServerPassword("plain-secret");

    expect(encrypted).toMatch(/^enc:v1:/);
    expect(isEncryptedServerPassword(encrypted)).toBe(true);
    expect(decryptServerPassword(encrypted)).toBe("plain-secret");
  });

  it("keeps legacy server passwords readable during zero-downtime migration", () => {
    expect(isEncryptedServerPassword("legacy-secret")).toBe(false);
    expect(decryptServerPassword("legacy-secret")).toBe("legacy-secret");
  });
});
