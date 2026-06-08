import { PassThrough } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	assertStorageAccessMock,
	connectMock,
	endMock,
	prismaMock,
	requireHandlerMock,
	sftpCreateReadStreamMock,
	sftpStatMock,
} = vi.hoisted(() => ({
	assertStorageAccessMock: vi.fn(() => Promise.resolve({ allowed: true })),
	connectMock: vi.fn(),
	endMock: vi.fn(),
	prismaMock: {
		storageNode: {
			findUnique: vi.fn(),
		},
	},
	requireHandlerMock: vi.fn(),
	sftpCreateReadStreamMock: vi.fn(),
	sftpStatMock: vi.fn(),
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

		sftp(callback: (err: Error | undefined, sftp: unknown) => void) {
			callback(undefined, {
				stat: sftpStatMock,
				createReadStream: sftpCreateReadStreamMock,
			});
		}

		end() {
			endMock();
		}
	},
}));

vi.mock("@/lib/http/api-guard", () => ({
	withApiRoute: requireHandlerMock,
}));

vi.mock("@/lib/db", () => ({
	prisma: prismaMock,
}));

vi.mock("@/lib/storage/access-control", () => ({
	assertStorageAccess: assertStorageAccessMock,
}));

vi.mock("@/lib/storage/ssh-credentials", () => ({
	resolveStorageSshCredentials: vi.fn(() => ({
		host: "203.0.113.20",
		port: 2222,
		username: "deploy",
		password: "secret",
		privateKey: undefined,
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
		requireHandlerMock.mockImplementation(async (request, _options, handler) => handler({ session }));
		prismaMock.storageNode.findUnique.mockResolvedValue(sftpNode);
		assertStorageAccessMock.mockResolvedValue({ allowed: true });
		sftpStatMock.mockImplementation((_path: string, callback: (err: Error | undefined, stats: unknown) => void) => {
			callback(undefined, { isFile: () => true, size: 12 });
		});
		sftpCreateReadStreamMock.mockImplementation(() => streamWithData());
	});

	it("streams full SFTP downloads through shared private headers", async () => {
		const response = await GET(
			new Request("https://example.com/api/storage/sftp-download?nodeId=node_1&path=movies%2Fdemo.mp4"),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("accept-ranges")).toBe("bytes");
		expect(response.headers.get("content-length")).toBe("12");
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

	it("rejects paths outside the storage root before connecting", async () => {
		const response = await GET(
			new Request("https://example.com/api/storage/sftp-download?nodeId=node_1&path=..%2Fsecret.txt"),
		);

		expect(response.status).toBe(400);
		expect(connectMock).not.toHaveBeenCalled();
		expect(sftpStatMock).not.toHaveBeenCalled();
	});
});
