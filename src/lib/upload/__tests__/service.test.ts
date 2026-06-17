/**
 * TR-009 55c: Media resumable upload — service unit tests.
 *
 * Mirrors the P-NEW-AM pattern from src/lib/cost/__tests__/service.test.ts:
 *   - module-level `store` closure + resetStore()
 *   - vi.mock("@/lib/db", () => ({ prisma: makePrismaMock() }))
 *   - beforeEach reset store, afterEach clearAllMocks
 *
 * Tests cover: init / get / append / complete / cancel / sweep / error
 * codes. Real filesystem is used for chunk files via a tmp dir under
 * UPLOAD_TMP_DIR.
 */
import * as fs from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SessionRow = {
	id: string;
	userId: string;
	filename: string;
	mimeType: string;
	totalSize: bigint;
	chunkSize: number;
	totalChunks: number;
	receivedChunks: number[];
	storageNodeId: string | null;
	relativePath: string | null;
	status: string;
	resultImageId: string | null;
	checksum: string | null;
	errorMessage: string | null;
	expiresAt: Date;
	completedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

const store = {
	sessions: new Map<string, SessionRow>(),
	seq: 0,
};

function resetStore() {
	store.sessions.clear();
	store.seq = 0;
}

function makeRow(data: Partial<SessionRow> & { id: string; userId: string }): SessionRow {
	const base = new Date("2026-06-17T00:00:00Z").getTime();
	return {
		filename: "untitled.png",
		mimeType: "image/png",
		totalSize: BigInt(1024),
		chunkSize: 256,
		totalChunks: 4,
		receivedChunks: [],
		storageNodeId: null,
		relativePath: null,
		status: "PENDING",
		resultImageId: null,
		checksum: null,
		errorMessage: null,
		expiresAt: new Date(base + 86400 * 1000),
		completedAt: null,
		createdAt: new Date(base),
		updatedAt: new Date(base),
		...data,
	};
}

function makePrismaMock() {
	return {
		mediaUploadSession: {
			create: vi.fn(
				async ({ data }: { data: Omit<SessionRow, "id" | "createdAt" | "updatedAt" | "receivedChunks"> & { receivedChunks?: number[] } }) => {
					store.seq += 1;
					const row = makeRow({
						id: `sess_${store.seq}`,
						userId: data.userId,
						filename: data.filename,
						mimeType: data.mimeType,
						totalSize: data.totalSize,
						chunkSize: data.chunkSize,
						totalChunks: data.totalChunks,
						receivedChunks: data.receivedChunks ?? [],
						storageNodeId: data.storageNodeId,
						relativePath: data.relativePath,
						status: data.status,
						expiresAt: data.expiresAt,
					});
					store.sessions.set(row.id, row);
					return row;
				},
			),
			findFirst: vi.fn(
				async ({ where }: { where: { id: string; userId: string } }) => {
					const row = store.sessions.get(where.id);
					if (!row) return null;
					if (row.userId !== where.userId) return null;
					return row;
				},
			),
			findUnique: vi.fn(
				async ({ where }: { where: { id: string } }) => {
					return store.sessions.get(where.id) ?? null;
				},
			),
			findUniqueOrThrow: vi.fn(
				async ({ where }: { where: { id: string } }) => {
					const row = store.sessions.get(where.id);
					if (!row) throw new Error("not found");
					return row;
				},
			),
			update: vi.fn(
				async ({ where, data }: { where: { id: string }; data: Partial<SessionRow> }) => {
					const row = store.sessions.get(where.id);
					if (!row) throw new Error("not found");
					const next: SessionRow = {
						...row,
						...data,
						updatedAt: new Date("2026-06-17T01:00:00Z"),
					};
					store.sessions.set(where.id, next);
					return next;
				},
			),
			updateMany: vi.fn(
				async ({ where, data }: { where: { id: string | { in: string[] }; userId?: string }; data: Partial<SessionRow> }) => {
					let ids: string[];
					if (typeof where.id === "string") {
						ids = [where.id];
					} else {
						ids = where.id.in;
					}
					const userIdFilter = where.userId;
					let count = 0;
					for (const id of ids) {
						const row = store.sessions.get(id);
						if (!row) continue;
						if (userIdFilter !== undefined && row.userId !== userIdFilter) continue;
						const next: SessionRow = {
							...row,
							...data,
							updatedAt: new Date("2026-06-17T01:00:00Z"),
						};
						store.sessions.set(id, next);
						count += 1;
					}
					return { count };
				},
			),
			findMany: vi.fn(
				async ({
					where = {},
				}: {
					where?: { expiresAt?: { lt: Date }; status?: { in: string[] } };
				}) => {
					let rows = [...store.sessions.values()];
					if (where.expiresAt?.lt) {
						rows = rows.filter((r) => r.expiresAt.getTime() < where.expiresAt!.lt!.getTime());
					}
					if (where.status?.in) {
						rows = rows.filter((r) => where.status!.in!.includes(r.status));
					}
					return rows.map((r) => ({ id: r.id }));
				},
			),
		},
	};
}

vi.mock("@/lib/db", () => ({ prisma: makePrismaMock() }));

import {
	UPLOAD_TMP_DIR,
	appendMediaUploadChunk,
	assembleMediaUploadChunks,
	cancelMediaUploadSession,
	cleanupMediaUploadTempDir,
	completeMediaUploadSession,
	getMediaUploadSession,
	initMediaUploadSession,
	readSessionTempDir,
	sweepExpiredMediaUploadSessions,
} from "../service";
import { DEFAULT_CHUNK_SIZE, MAX_TOTAL_SIZE } from "../types";

const TEST_USER = "user_55c";

async function cleanTestDir() {
	try {
		await fs.rm(UPLOAD_TMP_DIR, { recursive: true, force: true });
	} catch {
		// best-effort
	}
}

beforeEach(async () => {
	resetStore();
	await cleanTestDir();
});

afterEach(async () => {
	vi.clearAllMocks();
	await cleanTestDir();
});

describe("initMediaUploadSession", () => {
	it("creates a PENDING session with computed totalChunks", async () => {
		const view = await initMediaUploadSession({
			userId: TEST_USER,
			filename: "photo.jpg",
			mimeType: "image/jpeg",
			totalSize: 1024 * 1024 + 1, // 1MB + 1 byte
		});
		expect(view.status).toBe("PENDING");
		expect(view.totalChunks).toBe(Math.ceil((1024 * 1024 + 1) / DEFAULT_CHUNK_SIZE));
		expect(view.receivedChunks).toEqual([]);
		expect(view.missingChunks.length).toBe(view.totalChunks);
		expect(view.checksum).toBeNull();
	});

	it("rejects oversized totalSize", async () => {
		await expect(
			initMediaUploadSession({
				userId: TEST_USER,
				filename: "huge.bin",
				mimeType: "image/png",
				totalSize: MAX_TOTAL_SIZE + 1,
			}),
		).rejects.toThrow(/exceeds limit/);
	});

	it("honours custom chunkSize", async () => {
		const view = await initMediaUploadSession({
			userId: TEST_USER,
			filename: "a.png",
			mimeType: "image/png",
			totalSize: 1000,
			chunkSize: 100,
		});
		expect(view.chunkSize).toBe(100);
		expect(view.totalChunks).toBe(10);
	});
});

describe("getMediaUploadSession", () => {
	it("returns null for unknown id", async () => {
		expect(await getMediaUploadSession("missing", TEST_USER)).toBeNull();
	});

	it("returns null when owned by a different user", async () => {
		const view = await initMediaUploadSession({
			userId: TEST_USER,
			filename: "a.png",
			mimeType: "image/png",
			totalSize: 100,
		});
		expect(await getMediaUploadSession(view.id, "other_user")).toBeNull();
	});
});

describe("appendMediaUploadChunk", () => {
	it("writes chunk file, transitions PENDING→UPLOADING, dedupes indices", async () => {
		const view = await initMediaUploadSession({
			userId: TEST_USER,
			filename: "a.png",
			mimeType: "image/png",
			totalSize: 1000,
			chunkSize: 100,
		});
		const id = view.id;
		expect(view.totalChunks).toBe(10);

		const after1 = await appendMediaUploadChunk({
			sessionId: id,
			userId: TEST_USER,
			index: 0,
			size: 100,
			buffer: Buffer.alloc(100, 0xaa),
		});
		expect(after1.status).toBe("UPLOADING");
		expect(after1.receivedChunks).toEqual([0]);
		expect(after1.missingChunks.length).toBe(9);

		// Re-upload same index: dedupes, no duplicate file write outside
		// the on-disk overwrite.
		const after1dup = await appendMediaUploadChunk({
			sessionId: id,
			userId: TEST_USER,
			index: 0,
			size: 100,
			buffer: Buffer.alloc(100, 0xbb),
		});
		expect(after1dup.receivedChunks).toEqual([0]);

		const after2 = await appendMediaUploadChunk({
			sessionId: id,
			userId: TEST_USER,
			index: 3,
			size: 100,
			buffer: Buffer.alloc(100, 0xcc),
		});
		expect(after2.receivedChunks).toEqual([0, 3]);

		// On disk we should have chunk-0 + chunk-3 (sorted alphabetically)
		const files = await readSessionTempDir(id);
		expect(files).toEqual(["chunk-0", "chunk-3"]);
	});

	it("rejects mismatched buffer.size vs declared size", async () => {
		const view = await initMediaUploadSession({
			userId: TEST_USER,
			filename: "a.png",
			mimeType: "image/png",
			totalSize: 1000,
			chunkSize: 100,
		});
		await expect(
			appendMediaUploadChunk({
				sessionId: view.id,
				userId: TEST_USER,
				index: 0,
				size: 100,
				buffer: Buffer.alloc(99, 0xaa),
			}),
		).rejects.toThrow(/不匹配/);
	});

	it("rejects out-of-range index", async () => {
		const view = await initMediaUploadSession({
			userId: TEST_USER,
			filename: "a.png",
			mimeType: "image/png",
			totalSize: 1000,
			chunkSize: 100,
		});
		await expect(
			appendMediaUploadChunk({
				sessionId: view.id,
				userId: TEST_USER,
				index: 100,
				size: 100,
				buffer: Buffer.alloc(100, 0xaa),
			}),
		).rejects.toThrow(/超出/);
	});

	it("refuses append after COMPLETED", async () => {
		const view = await initMediaUploadSession({
			userId: TEST_USER,
			filename: "a.png",
			mimeType: "image/png",
			totalSize: 100,
			chunkSize: 100,
		});
		// Simulate full upload + complete
		await appendMediaUploadChunk({
			sessionId: view.id,
			userId: TEST_USER,
			index: 0,
			size: 100,
			buffer: Buffer.alloc(100, 0xaa),
		});
		const buf = await assembleMediaUploadChunks(view.id, TEST_USER);
		await completeMediaUploadSession({
			sessionId: view.id,
			userId: TEST_USER,
			buffer: buf,
		});
		await expect(
			appendMediaUploadChunk({
				sessionId: view.id,
				userId: TEST_USER,
				index: 0,
				size: 100,
				buffer: Buffer.alloc(100, 0xaa),
			}),
		).rejects.toThrow(/已完成/);
	});
});

describe("assembleMediaUploadChunks", () => {
	it("concatenates chunks in order, throws on missing", async () => {
		const view = await initMediaUploadSession({
			userId: TEST_USER,
			filename: "a.png",
			mimeType: "image/png",
			totalSize: 30,
			chunkSize: 10,
		});
		// Upload chunks in non-sequential order to verify ordering
		for (const idx of [2, 0, 1]) {
			await appendMediaUploadChunk({
				sessionId: view.id,
				userId: TEST_USER,
				index: idx,
				size: 10,
				buffer: Buffer.from(`chunk-${idx}`.padStart(10, "_")),
			});
		}
		const buf = await assembleMediaUploadChunks(view.id, TEST_USER);
		expect(buf.toString()).toBe("___chunk-0___chunk-1___chunk-2");
	});

	it("throws chunks_incomplete when missing", async () => {
		const view = await initMediaUploadSession({
			userId: TEST_USER,
			filename: "a.png",
			mimeType: "image/png",
			totalSize: 30,
			chunkSize: 10,
		});
		await appendMediaUploadChunk({
			sessionId: view.id,
			userId: TEST_USER,
			index: 0,
			size: 10,
			buffer: Buffer.alloc(10, 0xaa),
		});
		await expect(
			assembleMediaUploadChunks(view.id, TEST_USER),
		).rejects.toThrow(/缺失 2 个 chunk/);
	});
});

describe("completeMediaUploadSession", () => {
	it("flips status to COMPLETED, records sha256, removes temp dir", async () => {
		const view = await initMediaUploadSession({
			userId: TEST_USER,
			filename: "a.png",
			mimeType: "image/png",
			totalSize: 20,
			chunkSize: 10,
		});
		for (let i = 0; i < 2; i++) {
			await appendMediaUploadChunk({
				sessionId: view.id,
				userId: TEST_USER,
				index: i,
				size: 10,
				buffer: Buffer.from(`part-${i}`.padStart(10, "_")),
			});
		}
		const buf = await assembleMediaUploadChunks(view.id, TEST_USER);
		const after = await completeMediaUploadSession({
			sessionId: view.id,
			userId: TEST_USER,
			buffer: buf,
		});
		expect(after.status).toBe("COMPLETED");
		expect(after.checksum).toMatch(/^[a-f0-9]{64}$/);
		expect(after.completedAt).toBeTruthy();
		expect(await readSessionTempDir(view.id)).toEqual([]);
	});

	it("refuses complete when caller is not owner", async () => {
		const view = await initMediaUploadSession({
			userId: TEST_USER,
			filename: "a.png",
			mimeType: "image/png",
			totalSize: 10,
			chunkSize: 10,
		});
		await appendMediaUploadChunk({
			sessionId: view.id,
			userId: TEST_USER,
			index: 0,
			size: 10,
			buffer: Buffer.alloc(10, 0xaa),
		});
		const buf = await assembleMediaUploadChunks(view.id, TEST_USER);
		await expect(
			completeMediaUploadSession({
				sessionId: view.id,
				userId: "stranger",
				buffer: buf,
			}),
		).rejects.toThrow(/不存在或不属于/);
	});
});

describe("cancelMediaUploadSession", () => {
	it("flips to CANCELLED, removes temp dir", async () => {
		const view = await initMediaUploadSession({
			userId: TEST_USER,
			filename: "a.png",
			mimeType: "image/png",
			totalSize: 30,
			chunkSize: 10,
		});
		await appendMediaUploadChunk({
			sessionId: view.id,
			userId: TEST_USER,
			index: 0,
			size: 10,
			buffer: Buffer.alloc(10, 0xaa),
		});
		const after = await cancelMediaUploadSession(view.id, TEST_USER);
		expect(after.status).toBe("CANCELLED");
		expect(await readSessionTempDir(view.id)).toEqual([]);
	});
});

describe("sweepExpiredMediaUploadSessions", () => {
	it("cancels PENDING/UPLOADING sessions past expiresAt", async () => {
		const view = await initMediaUploadSession({
			userId: TEST_USER,
			filename: "a.png",
			mimeType: "image/png",
			totalSize: 30,
			chunkSize: 10,
			ttlMs: 1, // expires immediately
		});
		// Wait long enough for the session to expire
		await new Promise((r) => setTimeout(r, 50));
		const swept = await sweepExpiredMediaUploadSessions();
		expect(swept).toBe(1);
		// After sweep, status should be CANCELLED
		const after = await getMediaUploadSession(view.id, TEST_USER);
		expect(after?.status).toBe("CANCELLED");
	});
});

describe("cleanupMediaUploadTempDir", () => {
	it("is idempotent on missing dir", async () => {
		await expect(cleanupMediaUploadTempDir("does-not-exist")).resolves.toBeUndefined();
	});
});
