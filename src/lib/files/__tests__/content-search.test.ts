import { describe, it, expect, vi, beforeEach } from "vitest";

const { findManyMock, teamWhereMock } = vi.hoisted(() => ({
	findManyMock: vi.fn(),
	teamWhereMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
	prisma: { storageNode: { findMany: findManyMock } },
}));
vi.mock("@/lib/auth/team-scope", () => ({ teamWhere: teamWhereMock }));
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
vi.mock("@/lib/storage/access-control", () => ({ assertStorageAccess: vi.fn() }));

import { sanitizeSearchQuery, searchFileContents } from "../content-search";

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
	beforeEach(() => {
		vi.clearAllMocks();
		findManyMock.mockResolvedValue([]);
		teamWhereMock.mockReturnValue({});
	});

	// Test that empty query returns empty results
	it("returns empty results for empty query", async () => {
		const result = await searchFileContents({ query: "" });
		expect(result.results).toEqual([]);
		expect(result.totalMatches).toBe(0);
		expect(result.truncated).toBe(false);
	});

	it("applies teamWhere when session is provided", async () => {
		teamWhereMock.mockReturnValue({
			OR: [{ teamId: "team-a" }, { teamId: null }],
		});
		await searchFileContents({
			query: "secret",
			session: { userId: "u1", roles: ["operator"], currentTeamId: "team-a" },
		});
		expect(teamWhereMock).toHaveBeenCalledWith({
			userId: "u1",
			roles: ["operator"],
			currentTeamId: "team-a",
		});
		expect(findManyMock).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					OR: [{ teamId: "team-a" }, { teamId: null }],
				}),
			}),
		);
	});
});
