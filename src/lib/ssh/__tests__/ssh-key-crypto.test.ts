import { generateKeyPairSync } from "node:crypto";
import { utils } from "ssh2";
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearUnlockedSshKeyCacheForTests,
  decryptServerPassword,
  decryptSshPrivateKey,
  decryptStoredSshKey,
  encryptServerPassword,
  encryptSshKeyPassphrase,
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

describe("decryptStoredSshKey", () => {
  const passphrase = " legacy pass ";
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const openssh = utils.generateKeyPairSync("ed25519", { passphrase, cipher: "aes256-cbc", rounds: 4 });
  const legacyKeys = [
    ["OpenSSH (bcrypt KDF)", openssh.private],
    ["encrypted PKCS#8 PEM", rsa.privateKey.export({ format: "pem", type: "pkcs8", cipher: "aes-256-cbc", passphrase }).toString()],
    ["encrypted legacy RSA PEM", rsa.privateKey.export({ format: "pem", type: "pkcs1", cipher: "aes-256-cbc", passphrase }).toString()],
  ] as const;

  beforeEach(() => clearUnlockedSshKeyCacheForTests());

  it("returns null when no key is bound", () => {
    expect(decryptStoredSshKey(null)).toBeNull();
    expect(decryptStoredSshKey({ privateKey: null, passphrase: null })).toBeNull();
  });

  it("returns keys stored without a passphrase unchanged", () => {
    expect(decryptStoredSshKey({ privateKey: encryptSshPrivateKey(SAMPLE_PRIVATE_KEY), passphrase: null }))
      .toEqual({ privateKey: SAMPLE_PRIVATE_KEY });
  });

  it.each(legacyKeys)("unlocks a passphrase-protected %s for prompt-free clients", (_name, privateKey) => {
    const stored = { privateKey: encryptSshPrivateKey(privateKey), passphrase: encryptSshKeyPassphrase(passphrase) };
    const unlocked = decryptStoredSshKey(stored);

    expect(unlocked?.passphrase).toBeUndefined();
    // ssh2 parses it without a passphrase, and so does `ssh -i` in BatchMode.
    const parsed = utils.parseKey(unlocked!.privateKey);
    expect(parsed).not.toBeInstanceOf(Error);
    expect(decryptStoredSshKey(stored)).toEqual(unlocked);
  });

  it("hands the passphrase to ssh2 when the key cannot be unlocked here", () => {
    const stored = { privateKey: encryptSshPrivateKey(openssh.private), passphrase: encryptSshKeyPassphrase("wrong") };
    expect(decryptStoredSshKey(stored)).toEqual({ privateKey: openssh.private, passphrase: "wrong" });
  });
});
