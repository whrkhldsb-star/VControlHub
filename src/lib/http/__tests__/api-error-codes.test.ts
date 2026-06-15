import { describe, expect, it } from "vitest";
import {
	ApiErrorCodeValues,
	categoryForCode,
	isApiErrorCode,
	toApiErrorCode,
} from "@/lib/http/api-error-codes";

describe("lib/http/api-error-codes", () => {
	describe("union", () => {
		it("ApiErrorCodeValues lists every member exactly once", () => {
			const set = new Set<string>(ApiErrorCodeValues);
			expect(set.size).toBe(ApiErrorCodeValues.length);
			// spot-check: a few of the most-used codes must be present
			expect(set.has("AUTH_REQUIRED")).toBe(true);
			expect(set.has("VALIDATION_FAILED")).toBe(true);
			expect(set.has("NOT_FOUND")).toBe(true);
			expect(set.has("INTERNAL_ERROR")).toBe(true);
		});

		it("isApiErrorCode narrows known codes", () => {
			expect(isApiErrorCode("NOT_FOUND")).toBe(true);
			expect(isApiErrorCode("AUTH_REQUIRED")).toBe(true);
		});

		it("isApiErrorCode rejects unknown / non-string values", () => {
			expect(isApiErrorCode("totally-not-a-code")).toBe(false);
			expect(isApiErrorCode("")).toBe(false);
			expect(isApiErrorCode(null)).toBe(false);
			expect(isApiErrorCode(undefined)).toBe(false);
			expect(isApiErrorCode(42)).toBe(false);
			expect(isApiErrorCode({ code: "NOT_FOUND" })).toBe(false);
		});

		it("toApiErrorCode passes known codes through", () => {
			expect(toApiErrorCode("NOT_FOUND")).toBe("NOT_FOUND");
			expect(toApiErrorCode("RATE_LIMITED")).toBe("RATE_LIMITED");
		});

		it("toApiErrorCode collapses unknowns to GENERIC_ERROR", () => {
			expect(toApiErrorCode("legacy-unknown-code")).toBe("GENERIC_ERROR");
			expect(toApiErrorCode(null)).toBe("GENERIC_ERROR");
			expect(toApiErrorCode(undefined)).toBe("GENERIC_ERROR");
			expect(toApiErrorCode(500)).toBe("GENERIC_ERROR");
		});
	});

	describe("categorisation", () => {
		it("AUTH_REQUIRED is auth, FORBIDDEN is permission", () => {
			expect(categoryForCode("AUTH_REQUIRED")).toBe("auth");
			expect(categoryForCode("FORBIDDEN")).toBe("permission");
		});

		it("VALIDATION_FAILED + invalid-input family are validation", () => {
			expect(categoryForCode("VALIDATION_FAILED")).toBe("validation");
			expect(categoryForCode("INVALID_PORT")).toBe("validation");
			expect(categoryForCode("MISSING_FIELD")).toBe("validation");
		});

		it("NOT_FOUND / CONFLICT / BUSINESS / RATE_LIMITED / 5xx map correctly", () => {
			expect(categoryForCode("NOT_FOUND")).toBe("notfound");
			expect(categoryForCode("CONFLICT")).toBe("conflict");
			expect(categoryForCode("BUSINESS_RULE_FAILED")).toBe("business");
			expect(categoryForCode("RATE_LIMITED")).toBe("ratelimit");
			expect(categoryForCode("INTERNAL_ERROR")).toBe("server");
			expect(categoryForCode("DATABASE_ERROR")).toBe("server");
		});

		it("every code in ApiErrorCodeValues has a category (no holes in the table)", () => {
			const allowed = [
				"auth",
				"permission",
				"validation",
				"notfound",
				"conflict",
				"business",
				"ratelimit",
				"server",
				"unknown",
			] as const;
			for (const code of ApiErrorCodeValues) {
				// If a new code is added to the union but forgotten in the
				// CODE_CATEGORY table, categoryForCode will fall through to
				// undefined (or a wrong value) and this assertion will fail.
				const category = categoryForCode(code);
				expect(allowed).toContain(category);
			}
		});
	});
});
