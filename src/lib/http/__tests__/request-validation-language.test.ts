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
	// A sentence no catalog knows (this test's own) stays as written.
	email: z.string().email("Enter a valid email address"),
});
// Sentences schema authors wrote, as they stand in src/lib/user/schema.ts and src/lib/auth/schema.ts.
const accountSchema = z.object({
	username: z.string().min(2, "Username must be at least 2 characters"),
	displayName: z.string().max(80, "Display name must be at most 80 characters"),
	newPassword: z.string().min(8, "New password must be at least 8 characters"),
	note: z.string().max(500, "Note must be at most 500 characters"),
	port: z.number().int().max(65_535),
});
const account = { username: "alice", displayName: "Alice", newPassword: "Correct-Horse-1", note: "", port: 22 };
const querySchema = z.object({ page: z.coerce.number().int().min(1), size: z.coerce.number().int().max(200) });

async function refusal(locale: "zh" | "en", init: { body?: unknown; search?: string; schema?: z.ZodTypeAny }) {
	const response = await withApiRoute(
		new Request(`https://hub.example/api/demo${init.search ?? ""}`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie: `vps-locale=${locale}` },
			body: JSON.stringify(init.body ?? { name: "n", port: 22, email: "a@b.co" }),
		}),
		{ requireAuth: true, bodySchema: init.schema ?? bodySchema, querySchema: init.search ? querySchema : undefined },
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

// The reset-password dialog of a Chinese page said "newPassword: New password must be at least 8 characters":
// the sentence a schema's author wrote is a literal, which no locale of the validation library touches, and
// the field's internal name was put in front of it.
describe("a request refused with a sentence its schema's author wrote", () => {
	it("is answered with that sentence in the page's language, without the field's internal name", async () => {
		const body = { ...account, newPassword: "ab" };
		expect(await refusal("zh", { schema: accountSchema, body })).toEqual({
			status: 400,
			message: "新密码至少 8 位",
			issues: [{ path: "newPassword", message: "新密码至少 8 位" }],
		});
		expect(await refusal("en", { schema: accountSchema, body })).toEqual({
			status: 400,
			message: "New password must be at least 8 characters",
			issues: [{ path: "newPassword", message: "New password must be at least 8 characters" }],
		});
	});

	it("says what is wrong with each field when several are, instead of listing their internal names", async () => {
		const body = { ...account, username: "a", newPassword: "ab" };
		expect((await refusal("zh", { schema: accountSchema, body })).message).toBe("用户名至少 2 个字符；新密码至少 8 位");
		expect((await refusal("en", { schema: accountSchema, body })).message).toBe("Username must be at least 2 characters; New password must be at least 8 characters");
	});

	it("stops after three sentences", async () => {
		const body = { ...account, username: "a", displayName: "x".repeat(81), newPassword: "ab", note: "x".repeat(501) };
		expect((await refusal("zh", { schema: accountSchema, body })).message).toBe("用户名至少 2 个字符；显示名称最多 80 个字符；新密码至少 8 位…");
		expect((await refusal("en", { schema: accountSchema, body })).message).toBe(
			"Username must be at least 2 characters; Display name must be at most 80 characters; New password must be at least 8 characters…",
		);
	});

	it("keeps the field names when one of the refusals is the validation library's own, which names nothing", async () => {
		const body = { ...account, newPassword: "ab", port: 70_000 };
		const chinese = await refusal("zh", { schema: accountSchema, body });
		expect(chinese.message).toBe("2 个字段未通过校验：newPassword、port");
		expect(chinese.issues).toEqual([
			{ path: "newPassword", message: "新密码至少 8 位" },
			{ path: "port", message: "数值过大：期望 number <=65535" },
		]);
	});
});
