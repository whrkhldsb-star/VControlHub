import { describe, expect, it } from "vitest";
import { apiCatch, apiError } from "@/lib/http/api-error";
import {
	AuthError,
	BusinessError,
	NotFoundError,
	ValidationError,
} from "@/lib/errors";

async function readJson(res: Response) {
	return (await res.json()) as Record<string, unknown>;
}

describe("lib/http/api-error", () => {
	describe("apiError", () => {
		it("structured form emits code + message + error mirror", async () => {
			const res = apiError({
				code: "INVALID_PORT",
				message: "端口非法",
				status: 400,
			});
			expect(res.status).toBe(400);
			const body = await readJson(res);
			expect(body.code).toBe("INVALID_PORT");
			expect(body.message).toBe("端口非法");
			expect(body.error).toBe("端口非法");
			expect(body.details).toBeUndefined();
		});

		it("structured form preserves details payload", async () => {
			const res = apiError({
				code: "VALIDATION_FAILED",
				message: "x",
				status: 400,
				details: { fieldErrors: { name: ["required"] } },
			});
			const body = await readJson(res);
			expect(body.details).toEqual({ fieldErrors: { name: ["required"] } });
		});

		it("legacy (status, message) form defaults code=GENERIC_ERROR", async () => {
			const res = apiError(403, "无权访问");
			expect(res.status).toBe(403);
			const body = await readJson(res);
			expect(body.code).toBe("GENERIC_ERROR");
			expect(body.message).toBe("无权访问");
			expect(body.error).toBe("无权访问");
		});

		it("legacy form accepts optional code arg", async () => {
			const res = apiError(403, "无权访问", "PERMISSION_DENIED");
			const body = await readJson(res);
			expect(body.code).toBe("PERMISSION_DENIED");
		});
	});

	describe("apiCatch", () => {
		it("AppError subclass → maps status + code + details", async () => {
			const res = apiCatch(
				new ValidationError("bad", { fieldErrors: { x: ["required"] } }),
			);
			expect(res.status).toBe(400);
			const body = await readJson(res);
			expect(body.code).toBe("VALIDATION_FAILED");
			expect(body.message).toBe("bad");
			expect(body.details).toEqual({ fieldErrors: { x: ["required"] } });
		});

		it("NotFoundError → 404", async () => {
			const res = apiCatch(new NotFoundError("missing"));
			expect(res.status).toBe(404);
			const body = await readJson(res);
			expect(body.code).toBe("NOT_FOUND");
		});

		it("AuthError → 401", async () => {
			const res = apiCatch(new AuthError());
			expect(res.status).toBe(401);
			const body = await readJson(res);
			expect(body.code).toBe("AUTH_REQUIRED");
		});

		it("BusinessError default 422", async () => {
			const res = apiCatch(new BusinessError("storage offline"));
			expect(res.status).toBe(422);
			const body = await readJson(res);
			expect(body.code).toBe("BUSINESS_RULE_FAILED");
		});

		it("plain Error → fallbackStatus / GENERIC_ERROR for 4xx", async () => {
			const res = apiCatch(new Error("oops"), 400);
			expect(res.status).toBe(400);
			const body = await readJson(res);
			expect(body.code).toBe("GENERIC_ERROR");
			expect(body.message).toBe("oops");
		});

		it("plain Error → INTERNAL_ERROR for 5xx fallback", async () => {
			const res = apiCatch(new Error("oops"), 500);
			expect(res.status).toBe(500);
			const body = await readJson(res);
			expect(body.code).toBe("INTERNAL_ERROR");
		});

		it("non-Error value → fallback message + INTERNAL_ERROR", async () => {
			const res = apiCatch("string thrown", 500);
			expect(res.status).toBe(500);
			const body = await readJson(res);
			expect(body.code).toBe("INTERNAL_ERROR");
			expect(body.message).toBe("操作失败");
		});
	});
});
