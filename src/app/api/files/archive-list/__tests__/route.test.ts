import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireSessionMock, sessionHasPermissionMock, prismaMock } = vi.hoisted(() => ({
	requireSessionMock: vi.fn(),
	sessionHasPermissionMock: vi.fn(),
	prismaMock: { storageNode: { findUnique: vi.fn() } },
}));

vi.mock("@/lib/auth/require-session", () => ({ requireSession: requireSessionMock }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: sessionHasPermissionMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { GET } from "../route";

let tempDir: string;

async function createTarGz() {
	tempDir = await mkdtemp(path.join(os.tmpdir(), "vch-archive-list-"));
	await writeFile(path.join(tempDir, "hello.txt"), "hello");
	const archivePath = path.join(tempDir, "backup.tar.gz");
	const { execFile } = await import("node:child_process");
	await new Promise<void>((resolve, reject) => {
		execFile("tar", ["-czf", archivePath, "-C", tempDir, "hello.txt"], (error) => error ? reject(error) : resolve());
	});
	return archivePath;
}

describe("GET /api/files/archive-list", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		requireSessionMock.mockResolvedValue({ userId: "u_1", username: "admin", roles: ["admin"] });
		sessionHasPermissionMock.mockReturnValue(true);
	});

	afterEach(async () => {
		if (tempDir) await rm(tempDir, { recursive: true, force: true });
		tempDir = "";
	});

	it("lists .tar.gz archives before falling back to plain .gz handling", async () => {
		await createTarGz();
		prismaMock.storageNode.findUnique.mockResolvedValue({ id: "node_1", name: "local", driver: "LOCAL", basePath: tempDir });

		const response = await GET(new NextRequest(`https://app.example.test/api/files/archive-list?nodeId=node_1&driver=LOCAL&relativePath=${encodeURIComponent("backup.tar.gz")}&name=backup.tar.gz`));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({ entries: [expect.objectContaining({ name: "hello.txt", isDirectory: false })] });
	});
});
