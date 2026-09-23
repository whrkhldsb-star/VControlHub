import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// Mock prisma and ssh client
vi.mock("@/lib/db", () => ({
	prisma: {
		server: {
			findUnique: vi.fn(),
		},
	},
}));

vi.mock("@/lib/ssh/client", () => ({
	buildSshParamsFromServer: vi.fn(),
	execRemoteCommand: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	}),
}));

const { httpRequestMock } = vi.hoisted(() => ({ httpRequestMock: vi.fn() }));

vi.mock("node:http", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:http")>();
	return {
		...actual,
		default: { ...actual, request: httpRequestMock },
		request: httpRequestMock,
	};
});

import { requestDockerEngine, requestRemoteDockerEngine, validateDockerApiPath } from "../engine-client";
import { prisma } from "@/lib/db";
import { execRemoteCommand } from "@/lib/ssh/client";

type FakeResponse = EventEmitter & { statusCode: number };
type FakeRequest = EventEmitter & { destroy: () => void; write: () => void; end: () => void };

function fakeHttpPair(statusCode = 200): { request: FakeRequest; response: FakeResponse } {
	const request = new EventEmitter() as FakeRequest;
	request.destroy = vi.fn();
	request.write = vi.fn();
	request.end = vi.fn();
	const response = new EventEmitter() as FakeResponse;
	response.statusCode = statusCode;
	httpRequestMock.mockImplementationOnce((_options: unknown, cb: (res: FakeResponse) => void) => {
		queueMicrotask(() => cb(response));
		return request;
	});
	return { request, response };
}

const mockServer = {
	id: "srv-1",
	name: "test-server",
	host: "10.0.0.1",
	port: 22,
	username: "root",
	password: null,
	sshKeyId: "key-1",
	hostKeySha256: "abc123",
	enabled: true,
	sshKey: { privateKey: "encrypted", passphrase: null },
};

describe("validateDockerApiPath", () => {
	it("allows standard Docker API paths", () => {
		expect(validateDockerApiPath("/containers/json?all=true")).toBe(true);
		expect(validateDockerApiPath("/containers/abc123/start")).toBe(true);
		expect(validateDockerApiPath("/networks")).toBe(true);
		expect(validateDockerApiPath("/volumes/create")).toBe(true);
	});

	it("rejects path traversal", () => {
		expect(validateDockerApiPath("/containers/../etc/passwd")).toBe(false);
	});

	it("rejects shell metacharacters", () => {
		expect(validateDockerApiPath("/containers/json; rm -rf /")).toBe(false);
		expect(validateDockerApiPath("/containers/$(id)")).toBe(false);
		expect(validateDockerApiPath("/containers/json`whoami`")).toBe(false);
	});

	it("rejects paths not starting with /", () => {
		expect(validateDockerApiPath("containers/json")).toBe(false);
	});
});

describe("requestDockerEngine (local socket)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("parses a JSON daemon response into data", async () => {
		const { response } = fakeHttpPair(200);

		const promise = requestDockerEngine("/containers/json", {
			unavailableData: [],
			loggerScope: "test",
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		response.emit("data", Buffer.from('[{"Id":"abc"}]'));
		response.emit("end");

		await expect(promise).resolves.toEqual({ ok: true, status: 200, data: [{ Id: "abc" }] });
	});

	it("aborts and reports 502 when the response exceeds the byte cap", async () => {
		const { request, response } = fakeHttpPair(200);

		const promise = requestDockerEngine("/containers/abc/logs", {
			unavailableData: [],
			loggerScope: "test",
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		// Two 17MB chunks push the total past the 32MB cap.
		response.emit("data", Buffer.alloc(17 * 1024 * 1024, "x"));
		response.emit("data", Buffer.alloc(17 * 1024 * 1024, "x"));

		await expect(promise).resolves.toMatchObject({
			ok: false,
			status: 502,
			data: { message: expect.stringContaining("exceeded") },
		});
		expect(request.destroy).toHaveBeenCalled();
	});
});

describe("requestRemoteDockerEngine", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 404 for non-existent server", async () => {
		vi.mocked(prisma.server.findUnique).mockResolvedValue(null);

		const result = await requestRemoteDockerEngine("nonexistent", "/containers/json", {
			unavailableData: [],
			loggerScope: "test",
		});

		expect(result.ok).toBe(false);
		expect(result.status).toBe(404);
	});

	it("returns 403 for disabled server", async () => {
		vi.mocked(prisma.server.findUnique).mockResolvedValue({
			...mockServer,
			enabled: false,
		} as never);

		const result = await requestRemoteDockerEngine("srv-1", "/containers/json", {
			unavailableData: [],
			loggerScope: "test",
		});

		expect(result.ok).toBe(false);
		expect(result.status).toBe(403);
	});

	it("returns dockerAvailable=false when curl fails with connection refused", async () => {
		vi.mocked(prisma.server.findUnique).mockResolvedValue(mockServer as never);
		vi.mocked(execRemoteCommand).mockResolvedValue({
			stdout: "",
			stderr: "curl: (7) Failed to connect to /var/run/docker.sock: Connection refused",
			exitCode: 7,
		});

		const result = await requestRemoteDockerEngine("srv-1", "/containers/json", {
			unavailableData: [],
			loggerScope: "test",
		});

		expect(result.ok).toBe(true);
		expect(result.dockerAvailable).toBe(false);
	});

	it("treats curl newline plus status 000 as an unavailable Docker socket", async () => {
		vi.mocked(prisma.server.findUnique).mockResolvedValue(mockServer as never);
		vi.mocked(execRemoteCommand).mockResolvedValue({
			stdout: "\n000",
			stderr: "",
			exitCode: 7,
		});

		const result = await requestRemoteDockerEngine("srv-1", "/containers/json", {
			unavailableData: [],
			loggerScope: "test",
		});

		expect(result).toMatchObject({
			ok: true,
			status: 200,
			data: [],
			dockerAvailable: false,
		});
	});

	it("parses successful Docker API response", async () => {
		vi.mocked(prisma.server.findUnique).mockResolvedValue(mockServer as never);
		// curl output: body + "\n" + http_status
		const dockerResponse = JSON.stringify([{ Id: "abc", Names: ["/test"] }]);
		vi.mocked(execRemoteCommand).mockResolvedValue({
			stdout: `${dockerResponse}\n200`,
			stderr: "",
			exitCode: 0,
		});

		const result = await requestRemoteDockerEngine("srv-1", "/containers/json?all=true", {
			unavailableData: [],
			loggerScope: "test",
		});

		expect(result.ok).toBe(true);
		expect(result.status).toBe(200);
		expect(Array.isArray(result.data)).toBe(true);
	});

	it("single-quotes the remote URL so & query params are not eaten by the shell", async () => {
		vi.mocked(prisma.server.findUnique).mockResolvedValue(mockServer as never);
		vi.mocked(execRemoteCommand).mockResolvedValue({ stdout: "logs\n200", stderr: "", exitCode: 0 });

		await requestRemoteDockerEngine("srv-1", "/containers/abc/logs?stdout=true&stderr=true&tail=100", {
			unavailableData: [],
			loggerScope: "test",
		});

		const passedCommand = vi.mocked(execRemoteCommand).mock.calls[0]![0].command;
		// The whole URL (including &-joined params) must be inside one single-quoted
		// argument; otherwise the remote shell backgrounds at the first & and drops
		// stderr + tail.
		expect(passedCommand).toContain("'http://localhost/containers/abc/logs?stdout=true&stderr=true&tail=100'");
	});

	it("handles non-200 HTTP status from Docker daemon", async () => {
		vi.mocked(prisma.server.findUnique).mockResolvedValue(mockServer as never);
		vi.mocked(execRemoteCommand).mockResolvedValue({
			stdout: '{"message": "Container not found"}\n404',
			stderr: "",
			exitCode: 0,
		});

		const result = await requestRemoteDockerEngine("srv-1", "/containers/nonexistent/json", {
			unavailableData: {},
			loggerScope: "test",
		});

		expect(result.ok).toBe(false);
		expect(result.status).toBe(404);
	});

	it("rejects invalid API paths to prevent injection", async () => {
		const result = await requestRemoteDockerEngine("srv-1", "/containers/$(rm -rf /)/json", {
			unavailableData: {},
			loggerScope: "test",
		});

		expect(result.ok).toBe(false);
		expect(result.status).toBe(400);
	});

	it("handles SSH connection failure", async () => {
		vi.mocked(prisma.server.findUnique).mockResolvedValue(mockServer as never);
		vi.mocked(execRemoteCommand).mockRejectedValue(new Error("Connection timed out"));

		const result = await requestRemoteDockerEngine("srv-1", "/containers/json", {
			unavailableData: [],
			loggerScope: "test",
		});

		expect(result.ok).toBe(false);
		expect(result.status).toBe(502);
		expect((result.data as { message: string }).message).toContain("SSH connection");
	});
});
