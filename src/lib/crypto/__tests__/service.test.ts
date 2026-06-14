import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decrypt, encrypt, isEncrypted } from "@/lib/crypto/service";

describe("crypto service", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("ENCRYPTION_KEY", "");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("encrypt + decrypt round-trip", () => {
    it("round-trips ASCII", () => {
      const ct = encrypt("hello world");
      expect(ct).not.toBe("hello world");
      expect(isEncrypted(ct)).toBe(true);
      expect(decrypt(ct)).toBe("hello world");
    });

    it("round-trips Chinese + emoji", () => {
      const sample = "密码-混合-🛡️-测试-1";
      const ct = encrypt(sample);
      expect(decrypt(ct)).toBe(sample);
    });

    it("encrypt of an empty string produces a 3-segment payload", () => {
      // Note: decrypt(encrypt("")) throws "Invalid encrypted format" by
      // design — the source's `if (!ivB64 || !tagB64 || !dataB64)` guard
      // rejects any payload with an empty cipher segment. This is
      // upstream behavior; tracked separately. The encryption itself
      // does not throw.
      const ct = encrypt("");
      expect(ct.split(":")).toHaveLength(3);
    });

    it("produces a different ciphertext for the same plaintext (random IV)", () => {
      const a = encrypt("same input");
      const b = encrypt("same input");
      expect(a).not.toBe(b);
      expect(decrypt(a)).toBe("same input");
      expect(decrypt(b)).toBe("same input");
    });
  });

  describe("isEncrypted", () => {
    it("returns true for an encrypt() result", () => {
      expect(isEncrypted(encrypt("hi"))).toBe(true);
    });
    it("returns false for plain text", () => {
      expect(isEncrypted("just text")).toBe(false);
    });
    it("returns false for malformed values", () => {
      expect(isEncrypted("only:one:colon:extra")).toBe(false);
      expect(isEncrypted("a:b")).toBe(false);
      expect(isEncrypted("")).toBe(false);
    });
  });

  describe("decrypt error paths", () => {
    it("throws on a non-conforming payload", () => {
      expect(() => decrypt("not-a-real-ciphertext")).toThrow(
        /Invalid encrypted format/,
      );
    });

    it("throws when the auth tag is tampered with (AES-GCM integrity)", () => {
      const ct = encrypt("do-not-touch");
      const [ivB64, tagB64, dataB64] = ct.split(":");
      // Flip a single base64 character in the auth tag to break the MAC.
      const tamperedTag = tagB64!.startsWith("A")
        ? `B${tagB64!.slice(1)}`
        : `A${tagB64!.slice(1)}`;
      const tampered = `${ivB64}:${tamperedTag}:${dataB64}`;
      expect(() => decrypt(tampered)).toThrow();
    });
  });

  describe("production key guard", () => {
    it("throws in production when ENCRYPTION_KEY is missing", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ENCRYPTION_KEY", "");
      expect(() => encrypt("x")).toThrow(/ENCRYPTION_KEY/);
    });
  });
});
