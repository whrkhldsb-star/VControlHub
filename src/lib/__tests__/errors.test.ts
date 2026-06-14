import { describe, expect, it } from "vitest";
import {
	AppError,
	AuthError,
	BusinessError,
	ConflictError,
	ForbiddenError,
	NotFoundError,
	RateLimitError,
	ValidationError,
	isAppError,
} from "@/lib/errors";

describe("lib/errors", () => {
	it("AppError carries code, message, status, details", () => {
		const err = new AppError({
			code: "CUSTOM",
			message: "boom",
			status: 418,
			details: { x: 1 },
		});
		expect(err).toBeInstanceOf(Error);
		expect(err.code).toBe("CUSTOM");
		expect(err.message).toBe("boom");
		expect(err.status).toBe(418);
		expect(err.details).toEqual({ x: 1 });
	});

	it("AuthError → 401 / AUTH_REQUIRED", () => {
		const e = new AuthError();
		expect(e.code).toBe("AUTH_REQUIRED");
		expect(e.status).toBe(401);
	});

	it("ForbiddenError → 403 / FORBIDDEN", () => {
		const e = new ForbiddenError("not allowed");
		expect(e.code).toBe("FORBIDDEN");
		expect(e.status).toBe(403);
		expect(e.message).toBe("not allowed");
	});

	it("NotFoundError → 404 / NOT_FOUND", () => {
		expect(new NotFoundError().status).toBe(404);
		expect(new NotFoundError().code).toBe("NOT_FOUND");
	});

	it("ValidationError carries field details", () => {
		const e = new ValidationError("bad", { fieldErrors: { name: ["required"] } });
		expect(e.status).toBe(400);
		expect(e.code).toBe("VALIDATION_FAILED");
		expect(e.details).toEqual({ fieldErrors: { name: ["required"] } });
	});

	it("ConflictError → 409 / CONFLICT", () => {
		expect(new ConflictError().status).toBe(409);
		expect(new ConflictError().code).toBe("CONFLICT");
	});

	it("RateLimitError → 429 / RATE_LIMITED", () => {
		expect(new RateLimitError().status).toBe(429);
		expect(new RateLimitError().code).toBe("RATE_LIMITED");
	});

	it("BusinessError defaults 422, allows override", () => {
		expect(new BusinessError("x").status).toBe(422);
		expect(new BusinessError("x", undefined, 451).status).toBe(451);
	});

	it("isAppError type guard", () => {
		expect(isAppError(new AuthError())).toBe(true);
		expect(isAppError(new Error("plain"))).toBe(false);
		expect(isAppError("string")).toBe(false);
		expect(isAppError(null)).toBe(false);
	});

	it("subclasses preserve `name` for stack traces", () => {
		expect(new AuthError().name).toBe("AuthError");
		expect(new NotFoundError().name).toBe("NotFoundError");
		expect(new ValidationError().name).toBe("ValidationError");
	});
});
