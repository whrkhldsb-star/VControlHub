import { describe, expect, it, vi } from "vitest";

/**
 * Three small guards that had no test reaching them, grouped because each is a
 * single pure decision that something security-relevant is built on:
 *
 *   - `filterByHrefPermissions` decides what appears in navigation and search.
 *   - `checkPasswordAgainstPolicy` / `loadPasswordPolicy` decide whether the
 *     admin-configured password rules actually bite.
 *   - `shellQuote` is what keeps generated shell commands from breaking out of
 *     their argument.
 *
 * Menu filtering is not an authorization boundary on its own — the routes carry
 * their own gates — but the "absent href is visible to everyone" default means a
 * new page added to the catalogue without a permission entry silently shows up
 * for viewers, so the default is worth pinning explicitly.
 */
import { filterByHrefPermissions } from "../filter-by-href-permissions";
import { checkPasswordAgainstPolicy, loadPasswordPolicy } from "../password-policy";
import { shellQuote } from "@/lib/shell-quote";

vi.mock("@/lib/settings/service", () => ({ getSetting: mocks.getSetting }));

const mocks = vi.hoisted(() => ({ getSetting: vi.fn() }));

describe("filterByHrefPermissions", () => {
	const items = [
		{ href: "/servers" },
		{ href: "/users" },
		{ href: "/about" },
		{ href: "/audit" },
	];
	const declared = {
		"/servers": ["server:read"],
		"/users": ["user:read", "role:manage"],
		"/audit": [],
	} as Record<string, readonly ("server:read" | "user:read" | "role:manage")[]>;

	it("keeps an href that declares no permissions", () => {
		// The permissive default: a page missing from the map is visible to any
		// authenticated user, so forgetting an entry over-shares rather than
		// locking people out.
		const held = new Set<string>();
		const out = filterByHrefPermissions(items, declared as never, (req) => req.some((p) => held.has(p)));
		expect(out.map((i) => i.href)).toEqual(["/about", "/audit"]);
	});

	it("treats an explicitly empty array the same as absent", () => {
		const out = filterByHrefPermissions([{ href: "/audit" }], declared as never, () => false);
		expect(out).toEqual([{ href: "/audit" }]);
	});

	it("requires only one of several declared permissions (canAny, not canAll)", () => {
		const held = new Set(["role:manage"]);
		const out = filterByHrefPermissions(items, declared as never, (req) => req.some((p) => held.has(p)));
		expect(out.map((i) => i.href)).toContain("/users");
	});

	it("drops an href whose declared permission the caller lacks", () => {
		const held = new Set(["user:read"]);
		const out = filterByHrefPermissions(items, declared as never, (req) => req.some((p) => held.has(p)));
		expect(out.map((i) => i.href)).not.toContain("/servers");
	});

	it("preserves the input order of the surviving items", () => {
		const held = new Set(["server:read", "user:read"]);
		const out = filterByHrefPermissions(items, declared as never, (req) => req.some((p) => held.has(p)));
		expect(out.map((i) => i.href)).toEqual(["/servers", "/users", "/about", "/audit"]);
	});
});

describe("checkPasswordAgainstPolicy", () => {
	const strict = { minLength: 12, requireUppercase: true, requireNumber: true, requireSpecial: true };

	it("accepts a password satisfying every rule", () => {
		expect(checkPasswordAgainstPolicy("Sufficiently1!", strict)).toBeNull();
	});

	it("reports the length violation first and names the configured minimum", () => {
		const message = checkPasswordAgainstPolicy("short", strict);
		expect(message).toContain("12");
	});

	it("counts characters, not bytes, so a multi-byte password is not over-credited", () => {
		// "密码" is 2 characters but 6 UTF-8 bytes; a byte-length check would let a
		// 4-character password through a minLength of 12.
		const message = checkPasswordAgainstPolicy("密码密码密码", { ...strict, requireUppercase: false, requireNumber: false, requireSpecial: false });
		expect(message).toContain("12");
	});

	it.each([
		["nouppercase1!x", "uppercase"],
		["NoDigitsHere!x", "digit"],
		["NoSpecialChar1x", "special"],
	])("rejects %s for the missing %s class", (password, expected) => {
		expect(checkPasswordAgainstPolicy(password, strict)).toContain(expected);
	});

	it("skips a class check the policy has turned off", () => {
		expect(
			checkPasswordAgainstPolicy("alllowercase", {
				minLength: 8,
				requireUppercase: false,
				requireNumber: false,
				requireSpecial: false,
			}),
		).toBeNull();
	});

	it.each(["!", "@", "#", "$", "%", "^", "&", "*", "_", "-", "+", "=", "[", "]", "{", "}", ";", ":", "'", '"', ",", ".", "<", ">", "/", "?", "\\", "|", "`", "~", "("])(
		"accepts %s as a special character",
		(ch) => {
			expect(
				checkPasswordAgainstPolicy(`Abcdefg1${ch}`, { minLength: 8, requireUppercase: true, requireNumber: true, requireSpecial: true }),
			).toBeNull();
		},
	);

	it("does not accept a space as a special character", () => {
		expect(
			checkPasswordAgainstPolicy("Abcdefg1 x", { minLength: 8, requireUppercase: true, requireNumber: true, requireSpecial: true }),
		).toContain("special");
	});
});

describe("loadPasswordPolicy", () => {
	it("reads the four platform settings and treats only 'true' as enabled", async () => {
		mocks.getSetting.mockImplementation(async (key: string) => {
			if (key === "password.minLength") return "16";
			if (key === "password.requireUppercase") return "true";
			if (key === "password.requireNumber") return "1"; // not "true"
			return "";
		});
		await expect(loadPasswordPolicy()).resolves.toEqual({
			minLength: 16,
			requireUppercase: true,
			requireNumber: false,
			requireSpecial: false,
		});
	});

	it.each([["", 8], ["not-a-number", 8], ["0", 8], ["-5", 8], ["10", 10]])(
		"falls back to a minLength of 8 for %s",
		async (raw, expected) => {
			mocks.getSetting.mockImplementation(async (key: string) => (key === "password.minLength" ? raw : ""));
			await expect(loadPasswordPolicy()).resolves.toMatchObject({ minLength: expected });
		},
	);
});

describe("shellQuote", () => {
	it("wraps a plain value in single quotes", () => {
		expect(shellQuote("plain")).toBe("'plain'");
	});

	it("neutralises an embedded single quote instead of ending the argument", () => {
		expect(shellQuote("it's")).toBe(`'it'\\''s'`);
	});

	it.each([
		"; rm -rf /",
		"$(whoami)",
		"`id`",
		"a && b",
		"a | b",
		"$HOME",
		"a\nb",
		"--flag",
	])("keeps %s inert inside the quotes", (value) => {
		const quoted = shellQuote(value);
		expect(quoted.startsWith("'")).toBe(true);
		expect(quoted.endsWith("'")).toBe(true);
		// The only way out of a single-quoted string is an unescaped quote.
		expect(quoted.slice(1, -1).includes("'")).toBe(value.includes("'"));
	});

	it("survives a payload crafted to close the quote and append a command", () => {
		// `'; id; echo '` would break out if the quote were not doubled up.
		const quoted = shellQuote("'; id; echo '");
		expect(quoted).toBe(`''\\''; id; echo '\\'''`);
	});

	it("quotes the empty string to an empty argument rather than nothing", () => {
		expect(shellQuote("")).toBe("''");
	});
});
