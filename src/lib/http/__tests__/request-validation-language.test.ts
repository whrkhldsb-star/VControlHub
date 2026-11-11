// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({ requireApiSession: vi.fn() }));

vi.mock("@/lib/auth/api-session", () => ({ requireApiSession: mocks.requireApiSession, isSessionPayload: () => true }));
vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: vi.fn() }));
vi.mock("@/lib/auth/bearer-token", () => ({ hasBearerAuthorization: () => false, authenticateBearerForPermissions: vi.fn() }));

import { ValidationError } from "@/lib/errors";
import { withApiCopyLocale } from "@/lib/i18n/api-copy";

import { withApiRoute } from "../api-guard";
import { parseSearchParams } from "../parse-search-params";

const bodySchema = z.object({
	name: z.string().min(1),
	port: z.number().int().max(65_535),
	// A schema's own wording is its author's: it stays as written.
	email: z.string().email("Enter a valid email address"),
});
const querySchema = z.object({ page: z.coerce.number().int().min(1), size: z.coerce.number().int().max(200) });

async function refusal(locale: "zh" | "en", init: { body?: unknown; search?: string }) {
	const response = await withApiRoute(
		new Request(`https://hub.example/api/demo${init.search ?? ""}`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie: `vps-locale=${locale}` },
			body: JSON.stringify(init.body ?? { name: "n", port: 22, email: "a@b.co" }),
		}),
		{ requireAuth: true, bodySchema, querySchema: init.search ? querySchema : undefined },
		async () => Response.json({ ok: true }),
	);
	const payload = (await response.json()) as { message: string; details?: { issues?: Array<{ path: string; message: string }> } };
	return { status: response.status, message: payload.message, issues: payload.details?.issues ?? [] };
}

beforeEach(() => {
	mocks.requireApiSession.mockResolvedValue({ userId: "u1", username: "alice", roles: ["admin"] });
});

// What the validation library says by itself ("Too small: expected string to have >=1 characters") and the
// summary built around it were English on every page.
describe("a request refused by its schema", () => {
	it("says so in Chinese on a Chinese page", async () => {
		expect(await refusal("zh", { body: { name: "", port: 22, email: "a@b.co" } })).toEqual({
			status: 400,
			message: "name: 数值过小：期望 string >=1 字符",
			issues: [{ path: "name", message: "数值过小：期望 string >=1 字符" }],
		});
	});

	it("keeps English on an English page", async () => {
		expect(await refusal("en", { body: { name: "", port: 22, email: "a@b.co" } })).toEqual({
			status: 400,
			message: "name: Too small: expected string to have >=1 characters",
			issues: [{ path: "name", message: "Too small: expected string to have >=1 characters" }],
		});
	});

	it("sums up several refused fields in the page's language", async () => {
		const body = { name: "", port: 70_000, email: "nope" };

		const chinese = await refusal("zh", { body });
		expect(chinese.message).toBe("3 个字段未通过校验：name、port、email");
		expect(chinese.issues.map((issue) => issue.message)).toEqual(["数值过小：期望 string >=1 字符", "数值过大：期望 number <=65535", "Enter a valid email address"]);

		expect((await refusal("en", { body })).message).toBe("3 field(s) failed validation: name, port, email");
	});

	it("does the same for the query string", async () => {
		expect((await refusal("zh", { search: "?page=0&size=10" })).message).toBe("page: 数值过小：期望 number >=1");
		expect((await refusal("zh", { search: "?page=0&size=500" })).message).toBe("2 个查询参数未通过校验：page、size");
		expect((await refusal("en", { search: "?page=0&size=500" })).message).toBe("2 query parameter(s) failed validation: page, size");
	});

	it("words a query read inside a handler the same way", () => {
		const read = () => {
			try {
				parseSearchParams(new URL("https://hub.example/api/demo?page=0&size=10"), querySchema);
				return null;
			} catch (error) {
				return error instanceof ValidationError ? error.message : String(error);
			}
		};

		expect(withApiCopyLocale("zh", read)).toBe("page: 数值过小：期望 number >=1");
		expect(withApiCopyLocale("en", read)).toBe("page: Too small: expected number to be >=1");
		// Outside a request (a script, a test): English, as API copy is.
		expect(read()).toBe("page: Too small: expected number to be >=1");
	});
});
