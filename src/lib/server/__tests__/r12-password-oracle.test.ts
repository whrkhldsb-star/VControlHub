import { describe, expect, it } from "vitest";
import { encrypt } from "@/lib/crypto/service";
import { decryptServerPassword, encryptServerPassword } from "@/lib/ssh/ssh-key-crypto";

describe("interactive server password encryption (anti-decryption-oracle)", () => {
  it("encrypts caller-supplied enc:v1: envelopes as literal passwords instead of passing them through", () => {
    const victimSecret = "super-secret-totp-or-ssh-key";
    const stolenCiphertext = `enc:v1:${encrypt(victimSecret)}`;

    // Interactive write paths must wrap the caller-supplied string unconditionally.
    const stored = encryptServerPassword(stolenCiphertext);
    expect(stored).not.toBe(stolenCiphertext);

    // Decrypting once for SSH auth must yield the literal string the caller pasted,
    // NEVER the victim's underlying plaintext.
    const sentToSshd = decryptServerPassword(stored);
    expect(sentToSshd).toBe(stolenCiphertext);
    expect(sentToSshd).not.toBe(victimSecret);
  });
});
