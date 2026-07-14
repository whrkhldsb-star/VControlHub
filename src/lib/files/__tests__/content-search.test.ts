import { describe, it, expect, vi, beforeEach } from "vitest";
import { sanitizeSearchQuery } from "../content-search";

// These tests focus on the pure functions and query sanitization.
// The full search functions require DB + SSH mocking which is covered
// by the integration test in the API route.

describe("sanitizeSearchQuery", () => {
	it("removes null bytes and control characters", () => {
		expect(sanitizeSearchQuery("hello\x00world")).toBe("helloworld");
		expect(sanitizeSearchQuery("test\x1b[31m")).toBe("test[31m");
		expect(sanitizeSearchQuery("query\x7f")).toBe("query");
	});

	it("preserves normal text", () => {
		expect(sanitizeSearchQuery("hello world")).toBe("hello world");
		expect(sanitizeSearchQuery("config.json")).toBe("config.json");
	});

	it("preserves unicode", () => {
		expect(sanitizeSearchQuery("你好世界")).toBe("你好世界");
	});
});

describe("searchFileContents", () => {
	// Test that empty query returns empty results
	it("returns empty results for empty query", async () => {
		// We need to mock prisma to avoid DB connection
		vi.mock("@/lib/db", () => ({
			prisma: {
				storageNode: {
					findMany: vi.fn().mockResolvedValue([]),
				},
			},
		}));

		vi.mock("@/lib/logging", () => ({
			createLogger: () => ({
				debug: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				info: vi.fn(),
			}),
		}));

		vi.mock("@/lib/ssh/client", () => ({
			buildSshParamsFromServer: vi.fn(),
			execRemoteCommand: vi.fn(),
		}));

		vi.mock("@/lib/storage/service-entries", () => ({
			resolveLocalAbsolutePath: vi.fn((base: string, rel: string) => `${base}/${rel}`),
		}));

		vi.mock("@/lib/storage/ssh-credentials", () => ({
			resolveStorageSshCredentials: vi.fn(),
		}));

		const { searchFileContents } = await import("../content-search");

		const result = await searchFileContents({ query: "" });
		expect(result.results).toEqual([]);
		expect(result.totalMatches).toBe(0);
		expect(result.truncated).toBe(false);
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});
});
