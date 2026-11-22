import { PassThrough } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	assertStorageAccessMock,
	connectMock,
	endMock,
	prismaMock,
	requireApiPermissionMock,
	sftpCreateReadStreamMock,
	sftpStatMock,
} = vi.hoisted(() => ({
	assertStorageAccessMock: vi.fn(() => Promise.resolve({ allowed: true })),
	connectMock: vi.fn(),
	endMock: vi.fn(),
	prismaMock: {
		fileEntry: { findFirst: vi.fn() },
		storageNode: {
			findUnique: vi.fn(),
			findFirst: vi.fn(),
		},
	},
	requireApiPermissionMock: vi.fn(),
	sftpCreateReadStreamMock: vi.fn(),
	sftpStatMock: vi.fn(),
}));

// No symlinks on the mocked host: physical path == lexical path.
vi.mock("@/lib/ssh/client", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/ssh/client")>()),
	resolveRemoteRealPath: vi.fn(async ({ remotePath }: { remotePath: string }) => remotePath),
}));
vi.mock("ssh2", () => ({
	Client: class MockClient {
		private handlers = new Map<string, (value?: unknown) => void>();

		on(event: string, handler: (value?: unknown) => void) {
			this.handlers.set(event, handler);
			return this;
		}

		connect(config: unknown) {
			connectMock(config);
			queueMicrotask(() => this.handlers.get("ready")?.());
		}

		// The shared SSH client now caps listeners on the client instance.
		setMaxListeners(_max: number) {
			return this;
		}

		sftp(callback: (err: Error | undefined, sftp: unknown) => void) {
			callback(undefined, {
				realpath: (file: string, done: (err: null, name: string) => void) => done(null, file),
				end: vi.fn(),
				stat: sftpStatMock,
				createReadStream: sftpCreateReadStreamMock,
			});
		}

		end() {
			endMock();
		}
	},
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: requireApiPermissionMock,
}));

vi.mock("@/lib/db", () => ({
	prisma: prismaMock,
}));

vi.mock("@/lib/storage/access-control", () => ({
	assertStorageAccess: assertStorageAccessMock,
	releaseStorageQuotaGuard: vi.fn(async () => undefined),
}));

vi.mock("@/lib/storage/ssh-credentials", () => ({
	resolveStorageSshCredentials: vi.fn(() => ({
		host: "203.0.113.20",
		port: 2222,
		username: "deploy",
		password: "secret",
		privateKey: undefined,
		hostKeySha256: "a".repeat(64),
	})),
}));

import { GET } from "../route";

const session = {
	userId: "u_1",
	username: "admin",
	roles: ["admin"],
	mustChangePassword: false,
};

const sftpNode = {
	id: "node_1",
	name: "远端媒体库",
	driver: "SFTP",
	basePath: "/data/storage",
	host: null,
	port: null,
	username: null,
	serverId: "server_1",
	server: {
		id: "server_1",
		host: "203.0.113.20",
		port: 2222,
		username: "deploy",
		connectionType: "PASSWORD",
		password: "secret",
		sshKey: null,
	},
};

function streamWithData(data = "hello remote") {
	const stream = new PassThrough();
	queueMicrotask(() => {
		stream.end(data);
	});
	return stream;
}

describe("/api/storage/sftp-download", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		requireApiPermissionMock.mockResolvedValue({ session });
		prismaMock.storageNode.findUnique.mockResolvedValue(sftpNode);
		prismaMock.storageNode.findFirst.mockResolvedValue(sftpNode);
		assertStorageAccessMock.mockResolvedValue({ allowed: true });
		prismaMock.fileEntry.findFirst.mockResolvedValue(null);
		sftpStatMock.mockImplementation((_path: string, callback: (err: Error | undefined, stats: unknown) => void) => {
			callback(undefined, { isFile: () => true, size: 12 });
		});
		sftpCreateReadStreamMock.mockImplementation(() => streamWithData());
	});

	it.each([false, true])("checks recycled ancestors before opening SSH (Windows OpenSSH: %s)", async windowsOpenSsh => {
		const { resolveStorageSshCredentials } = await import("@/lib/storage/ssh-credentials");
		vi.mocked(resolveStorageSshCredentials).mockReturnValueOnce({ ...resolveStorageSshCredentials(sftpNode as never), windowsOpenSsh });
		prismaMock.fileEntry.findFirst.mockResolvedValueOnce({ id: "deleted-path" });
		const response = await GET(
			new Request("https://example.com/api/storage/sftp-download?nodeId=node_1&path=movies%2Fdemo.mp4"),
		);

		expect(response.status).toBe(404);
		expect(prismaMock.fileEntry.findFirst).toHaveBeenCalledWith({
			where: { storageNodeId: "node_1", isDeleted: true, relativePath: {
				in: ["movies", "movies/demo.mp4"], ...(windowsOpenSsh && { mode: "insensitive" }),
			} },
			select: { id: true },
		});
		expect(connectMock).not.toHaveBeenCalled();
	});

	it("rejects a password node without a pin before realpath or any SSH authentication", async () => {
		const { resolveStorageSshCredentials } = await import("@/lib/storage/ssh-credentials");
		const { resolveRemoteRealPath } = await import("@/lib/ssh/client");
		vi.mocked(resolveStorageSshCredentials).mockReturnValueOnce({ ...resolveStorageSshCredentials(sftpNode as never), hostKeySha256: null });
		const response = await GET(new Request("https://example.com/api/storage/sftp-download?nodeId=node_1&path=test.txt"));
		expect(response.status).toBeGreaterThanOrEqual(400);
		expect(resolveRemoteRealPath).not.toHaveBeenCalled();
		expect(connectMock).not.toHaveBeenCalled();
	});
	it("streams full SFTP downloads through shared private headers", async () => {
		const response = await GET(
			new Request("https://example.com/api/storage/sftp-download?nodeId=node_1&path=movies%2Fdemo.mp4"),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("accept-ranges")).toBe("bytes");
		expect(response.headers.get("content-length")).toBe("12");
		expect(connectMock).toHaveBeenCalledTimes(1);
		expect(response.headers.get("content-type")).toBe("video/mp4");
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(response.headers.get("content-disposition")).toContain("inline");
		expect(sftpCreateReadStreamMock).toHaveBeenCalledWith("/data/storage/movies/demo.mp4", undefined);
		expect(assertStorageAccessMock).toHaveBeenCalledWith(expect.objectContaining({
			storageNodeId: "node_1",
			relativePath: "movies/demo.mp4",
			operation: "read",
		}));
	});

	it("returns 206 and opens the remote stream with byte range options", async () => {
		const response = await GET(
			new Request("https://example.com/api/storage/sftp-download?nodeId=node_1&path=movies%2Fdemo.mp4", {
				headers: { range: "bytes=2-5" },
			}),
		);

		expect(response.status).toBe(206);
		expect(response.headers.get("content-range")).toBe("bytes 2-5/12");
		expect(response.headers.get("content-length")).toBe("4");
		expect(sftpCreateReadStreamMock).toHaveBeenCalledWith("/data/storage/movies/demo.mp4", { start: 2, end: 5 });
	});

	it("returns 416 for unsatisfiable range without opening a data stream", async () => {
		const response = await GET(
			new Request("https://example.com/api/storage/sftp-download?nodeId=node_1&path=movies%2Fdemo.mp4", {
				headers: { range: "bytes=99-100" },
			}),
		);

		expect(response.status).toBe(416);
		expect(response.headers.get("content-range")).toBe("bytes */12");
		expect(sftpCreateReadStreamMock).not.toHaveBeenCalled();
		expect(endMock).toHaveBeenCalled();
	});

	it("rejects a padded final name before the query can trim it or open SSH", async () => {
		const response = await GET(new Request("https://example.com/api/storage/sftp-download?nodeId=node_1&path=public%2Ffile%20"));
		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/空白|whitespace/) });
		expect(connectMock).not.toHaveBeenCalled();
	});

	it("rejects paths outside the storage root before connecting", async () => {
		const response = await GET(
			new Request("https://example.com/api/storage/sftp-download?nodeId=node_1&path=..%2Fsecret.txt"),
		);

		expect(response.status).toBe(400);
		expect(connectMock).not.toHaveBeenCalled();
		expect(sftpStatMock).not.toHaveBeenCalled();
	});
});
