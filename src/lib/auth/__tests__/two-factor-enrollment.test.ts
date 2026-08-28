/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The enrollment ticket is the only thing standing between a session and
 * choosing which TOTP seed gets persisted for an account, so these cover the
 * four ways a ticket must fail: wrong signature, wrong user, expired, mangled.
 */

vi.mock("@/lib/auth/session", () => ({
	getSessionSigningSecret: () => "test-session-signing-secret",
}));

const { createTwoFactorEnrollmentToken, openTwoFactorEnrollmentToken } = await import(
	"../two-factor-enrollment"
);

const NOW = Date.UTC(2026, 7, 28, 12, 0, 0);

describe("two-factor enrollment ticket", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("round-trips the seed for the user it was minted for", () => {
		const token = createTwoFactorEnrollmentToken({
			userId: "u1",
			secret: "JBSWY3DPEHPK3PXP",
			now: NOW,
		});

		expect(openTwoFactorEnrollmentToken(token, { userId: "u1", now: NOW + 1000 })).toBe(
			"JBSWY3DPEHPK3PXP",
		);
	});

	it("refuses a ticket presented by a different user", () => {
		const token = createTwoFactorEnrollmentToken({
			userId: "u1",
			secret: "VICTIM_SEED",
			now: NOW,
		});

		expect(openTwoFactorEnrollmentToken(token, { userId: "u2", now: NOW + 1000 })).toBeNull();
	});

	it("refuses a ticket past its TTL", () => {
		const token = createTwoFactorEnrollmentToken({
			userId: "u1",
			secret: "JBSWY3DPEHPK3PXP",
			now: NOW,
		});

		// Valid at 9m59s, dead at 10m01s.
		expect(
			openTwoFactorEnrollmentToken(token, { userId: "u1", now: NOW + 9 * 60_000 + 59_000 }),
		).toBe("JBSWY3DPEHPK3PXP");
		expect(
			openTwoFactorEnrollmentToken(token, { userId: "u1", now: NOW + 10 * 60_000 + 1000 }),
		).toBeNull();
	});

	it("refuses a payload whose signature does not cover it", () => {
		const token = createTwoFactorEnrollmentToken({
			userId: "u1",
			secret: "REAL_SEED",
			now: NOW,
		});
		const [, signature] = token.split(".");

		// Swap in a payload naming a seed of the caller's choosing, keep the
		// signature: this is the exact attack the ticket exists to stop.
		const forgedPayload = Buffer.from(
			JSON.stringify({
				aud: "2fa-enrollment",
				userId: "u1",
				secret: "ATTACKER_CHOSEN_SEED",
				nonce: "x",
				iat: NOW,
				exp: NOW + 600_000,
			}),
			"utf8",
		).toString("base64url");

		expect(
			openTwoFactorEnrollmentToken(`${forgedPayload}.${signature}`, {
				userId: "u1",
				now: NOW + 1000,
			}),
		).toBeNull();
	});

	it("returns null instead of throwing on malformed input", () => {
		for (const bad of ["", "no-dot", "a.b", "....", "%%%.%%%"]) {
			expect(openTwoFactorEnrollmentToken(bad, { userId: "u1", now: NOW })).toBeNull();
		}
	});

	it("mints a distinct ticket each time for the same seed", () => {
		const first = createTwoFactorEnrollmentToken({ userId: "u1", secret: "S", now: NOW });
		const second = createTwoFactorEnrollmentToken({ userId: "u1", secret: "S", now: NOW });
		expect(first).not.toBe(second);
	});
});
