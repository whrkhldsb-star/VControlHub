import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const { findManyMock, findUniqueMock, entryFindManyMock, teamWhereMock, accessMock } = vi.hoisted(() => ({
	findManyMock: vi.fn(),
	findUniqueMock: vi.fn(),
	entryFindManyMock: vi.fn().mockResolvedValue([]),
	teamWhereMock: vi.fn(),
	accessMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
	prisma: {
		storageNode: { findMany: findManyMock, findUnique: findUniqueMock },
		fileEntry: { findMany: entryFindManyMock },
	},
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
vi.mock("@/lib/storage/access-control", () => ({ assertStorageAccess: accessMock }));

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
		entryFindManyMock.mockResolvedValue([]);
		teamWhereMock.mockReturnValue({});
		accessMock.mockResolvedValue({ allowed: true });
	});

	// Test that empty query returns empty results
	it("returns empty results for empty query", async () => {
		const result = await searchFileContents({ query: "" });
		expect(result.results).toEqual([]);
		expect(result.totalMatches).toBe(0);
		expect(result.truncated).toBe(false);
	});

	it("filters soft-deleted entries out of results with a search-scoped tombstone query", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "vch-content-search-"));
		try {
			// Real files on a real LOCAL node — the walk must actually run so
			// the tombstone filter is exercised non-vacuously.
			await writeFile(path.join(dir, "recycled.txt"), "match here\nnothing\n");
			await writeFile(path.join(dir, "live.txt"), "match again\n");
			findManyMock.mockResolvedValue([
				{ id: "node-a", name: "local", driver: "LOCAL", basePath: dir },
			]);
			entryFindManyMock.mockResolvedValue([
				{ storageNodeId: "node-a", relativePath: "recycled.txt" },
			]);

			const result = await searchFileContents({
				query: "match",
				nodeId: "node-a",
				session: { userId: "u1", roles: ["operator"], currentTeamId: "team-a" },
			});

			expect(
				result.results.some((r) => r.relativePath === "recycled.txt"),
			).toBe(false);
			expect(
				result.results.some((r) => r.relativePath === "live.txt"),
			).toBe(true);

			// Regression: the tombstone lookup must be scoped to this search's
			// (node, path) pairs — the old global scan pulled every tenant's
			// tombstones with no node filter and silently truncated at 10k rows.
			expect(entryFindManyMock).toHaveBeenCalledTimes(1);
			const tombstoneArg = entryFindManyMock.mock.calls[0]![0] as {
				where: { isDeleted: boolean; OR: Array<{ storageNodeId: string; relativePath: { in: string[] } }> };
			};
			expect(tombstoneArg.where.isDeleted).toBe(true);
			expect(tombstoneArg.where.OR).toHaveLength(1);
			expect(tombstoneArg.where.OR[0]!.storageNodeId).toBe("node-a");
			expect([...tombstoneArg.where.OR[0]!.relativePath.in].sort()).toEqual([
				"live.txt",
				"recycled.txt",
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("fetches SFTP snippets in ONE batched remote command", async () => {
		findManyMock.mockResolvedValue([
			{ id: "node-sftp", name: "remote", driver: "SFTP", basePath: "/srv/data" },
		]);
		findUniqueMock.mockResolvedValue({
			id: "node-sftp",
			name: "remote",
			basePath: "/srv/data",
			server: {
				id: "srv-1",
				operatingSystem: "linux",
				host: "10.0.0.5",
				port: 22,
				username: "root",
				password: "pw",
				hostKeySha256: null,
				sshKey: null,
			},
		});
		const { execRemoteCommand, buildSshParamsFromServer } = await import("@/lib/ssh/client");
		vi.mocked(buildSshParamsFromServer).mockResolvedValue({} as never);
		vi.mocked(execRemoteCommand)
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: "/srv/data/a.txt\n/srv/data/b.txt\n",
				stderr: "",
			})
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: "/srv/data/a.txt:3:match alpha\n/srv/data/b.txt:7:match beta\n",
				stderr: "",
			});

		const result = await searchFileContents({
			query: "match",
			nodeId: "node-sftp",
			session: { userId: "u1", roles: ["operator"], currentTeamId: "team-a" },
		});

		expect(result.results).toHaveLength(2);
		expect(result.results[0]!.snippets[0]).toContain("match alpha");
		expect(result.results[1]!.snippets[0]).toContain("match beta");
		// One exec for the grep -l sweep plus ONE for the whole snippet batch —
		// the old path ran one sequential exec per matched file.
		expect(execRemoteCommand).toHaveBeenCalledTimes(2);
		const snippetCommand = (
			vi.mocked(execRemoteCommand).mock.calls[1]![0] as { command: string }
		).command;
		expect(snippetCommand).toContain("grep -HnIF");
		expect(snippetCommand).toContain("/srv/data/a.txt");
		expect(snippetCommand).toContain("/srv/data/b.txt");
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
