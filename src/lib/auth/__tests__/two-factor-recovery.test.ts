import { describe, expect, it } from "vitest";

import {
  createTwoFactorRecoveryCodes,
  findMatchingTwoFactorRecoveryCode,
  normalizeTwoFactorRecoveryCode,
} from "@/lib/auth/two-factor-recovery";

describe("two-factor recovery codes", () => {
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
