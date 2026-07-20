import { beforeEach, describe, expect, it, vi } from "vitest";

const { encryptMock, decryptMock, isEncryptedMock } = vi.hoisted(() => ({
	encryptMock: vi.fn((v: string) => `enc:${v}`),
	decryptMock: vi.fn((v: string) => v.replace(/^enc:/, "")),
	isEncryptedMock: vi.fn((v: string) => v.startsWith("enc:")),
}));

vi.mock("@/lib/crypto/service", () => ({
	encrypt: encryptMock,
	decrypt: decryptMock,
	isEncrypted: isEncryptedMock,
}));

import { openTwoFactorSecret, sealTwoFactorSecret } from "@/lib/auth/two-factor-secret";

describe("two-factor-secret seal/open", () => {
	beforeEach(() => {
		encryptMock.mockClear();
		decryptMock.mockClear();
		isEncryptedMock.mockClear();
		encryptMock.mockImplementation((v: string) => `enc:${v}`);
		decryptMock.mockImplementation((v: string) => v.replace(/^enc:/, ""));
		isEncryptedMock.mockImplementation((v: string) => v.startsWith("enc:"));
	});

	it("seals plaintext via encrypt()", () => {
		expect(sealTwoFactorSecret("JBSWY3DPEHPK3PXP")).toBe("enc:JBSWY3DPEHPK3PXP");
		expect(encryptMock).toHaveBeenCalledWith("JBSWY3DPEHPK3PXP");
	});

	it("opens sealed values via decrypt()", () => {
		expect(openTwoFactorSecret("enc:JBSWY3DPEHPK3PXP")).toBe("JBSWY3DPEHPK3PXP");
		expect(decryptMock).toHaveBeenCalledWith("enc:JBSWY3DPEHPK3PXP");
	});

	it("passes through legacy plaintext without decrypt", () => {
		expect(openTwoFactorSecret("LEGACYPLAIN")).toBe("LEGACYPLAIN");
		expect(decryptMock).not.toHaveBeenCalled();
	});
});
