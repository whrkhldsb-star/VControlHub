// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../password";

const PASSWORD = "Correct-Horse-2026!";
// Hashes produced by bcryptjs 3.0.3 (the previous implementation) at cost 12 and
// cost 10. Every password stored before the switch to native bcrypt looks like
// one of these and must keep verifying; "$2a$" is the marker older bcryptjs
// releases wrote for the same algorithm.
const BCRYPTJS_COST_12 = "$2b$12$p3UxQ.DwBUCxvN/otrrdrOPNpde5CLppMWAbwukzSfFNy7Uay0fum";
const BCRYPTJS_COST_10 = "$2b$10$ZAk5O217C6lIUnIMqL4ziOWPuJ5vaN..6E03YQfAsRK6QzDusx6lW";
const LEGACY_2A = BCRYPTJS_COST_10.replace("$2b$", "$2a$");

describe("password hashing", () => {
	it.each(["a".repeat(72), "密".repeat(24)])("verifies the suffix beyond bcrypt's byte limit: %s", async (prefix) => {
		const hash = await hashPassword(prefix + "-original");
		expect(await verifyPassword(prefix + "-original", hash)).toBe(true);
		expect(await verifyPassword(prefix + "-different", hash)).toBe(false);
	});
	it("verifies hashes written by the previous bcryptjs implementation", async () => {
		await expect(verifyPassword(PASSWORD, BCRYPTJS_COST_12)).resolves.toBe(true);
		await expect(verifyPassword(PASSWORD, BCRYPTJS_COST_10)).resolves.toBe(true);
		await expect(verifyPassword(PASSWORD, LEGACY_2A)).resolves.toBe(true);
		await expect(verifyPassword("Correct-Horse-2026?", BCRYPTJS_COST_12)).resolves.toBe(false);
	});

	it("round-trips a fresh hash at the configured cost", async () => {
		const hash = await hashPassword(PASSWORD);
		expect(hash).toMatch(/^vch-bcrypt-sha256-v1:\$2b\$12\$/);
		await expect(verifyPassword(PASSWORD, hash)).resolves.toBe(true);
		await expect(verifyPassword(PASSWORD + "x", hash)).resolves.toBe(false);
	});

	it("rejects malformed stored hashes instead of throwing", async () => {
		await expect(verifyPassword(PASSWORD, "")).resolves.toBe(false);
		await expect(verifyPassword(PASSWORD, "not-a-bcrypt-hash")).resolves.toBe(false);
	});
});
