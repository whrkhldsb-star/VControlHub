import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { server: { findUnique: vi.fn() } } }));
vi.mock("@/lib/ssh/client", () => ({ buildSshParamsFromServer: vi.fn(async () => ({ host: "h", port: 22, username: "root" })), execRemoteCommand: vi.fn() }));
vi.mock("@/lib/logging", () => ({ createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
const { httpRequestMock } = vi.hoisted(() => ({ httpRequestMock: vi.fn() }));
vi.mock("node:http", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:http")>();
	return { ...actual, default: { ...actual, request: httpRequestMock }, request: httpRequestMock };
});

import { demuxDockerLogs, requestDockerEngine, requestRemoteDockerEngine } from "../engine-client";
import { prisma } from "@/lib/db";
import { execRemoteCommand } from "@/lib/ssh/client";

/** Docker's multiplexed log format: [stream, 0, 0, 0, uint32 length] + payload per chunk. */
function frame(stream: 1 | 2, text: string) {
	const payload = Buffer.from(text);
	const header = Buffer.alloc(8);
	header[0] = stream;
	header.writeUInt32BE(payload.length, 4);
	return Buffer.concat([header, payload]);
}
const framed = Buffer.concat([frame(1, "listening on :80\n"), frame(2, "warning: 服务慢\n"), frame(1, "x".repeat(300) + "\n")]);
const clean = "listening on :80\nwarning: 服务慢\n" + "x".repeat(300) + "\n";

beforeEach(() => {
	vi.mocked(prisma.server.findUnique).mockResolvedValue({ id: "srv", name: "vps", enabled: true, sshKey: null } as never);
});

describe("container logs", () => {
	it("strips the frame headers of a non-TTY container's log stream", () => {
		expect(demuxDockerLogs(framed)).toBe(clean);
	});

	it("leaves a TTY container's raw stream as it is", () => {
		expect(demuxDockerLogs(Buffer.from("plain tty output\n"))).toBe("plain tty output\n");
	});

	it("returns clean text from the hub host's Docker socket", async () => {
		const request = Object.assign(new EventEmitter(), { destroy: vi.fn(), write: vi.fn(), end: vi.fn() });
		const response = Object.assign(new EventEmitter(), { statusCode: 200, complete: true });
		httpRequestMock.mockImplementationOnce((_options: unknown, cb: (res: typeof response) => void) => {
			queueMicrotask(() => {
				cb(response);
				response.emit("data", framed);
				response.emit("end");
			});
			return request;
		});
		const result = await requestDockerEngine("/containers/web/logs?stdout=true&stderr=true&tail=100", { unavailableData: {}, loggerScope: "t", decode: "docker-logs" });
		expect(result.data).toBe(clean);
	});

	it("carries a remote server's binary log frames intact and returns clean text", async () => {
		// SSH output is decoded as UTF-8, which mangled the frame headers: the
		// remote side hands the bytes over base64-encoded instead.
		vi.mocked(execRemoteCommand).mockResolvedValueOnce({ stdout: `${framed.toString("base64")}\n200`, stderr: "", exitCode: 0 });
		const result = await requestRemoteDockerEngine("srv", "/containers/web/logs?stdout=true&stderr=true&tail=100", { unavailableData: {}, loggerScope: "t", decode: "docker-logs" });
		expect(result).toMatchObject({ ok: true, status: 200, data: clean });
		expect(vi.mocked(execRemoteCommand).mock.calls[0]![0].command).toContain("base64");
	});
});

describe("remote Docker request bodies", () => {
	it("declares JSON, which Docker requires for volume and network create", async () => {
		// curl -d defaults to form encoding: dockerd answered 400 "unsupported
		// Content-Type header (application/x-www-form-urlencoded)".
		vi.mocked(execRemoteCommand).mockResolvedValueOnce({ stdout: '{"Name":"cache"}\n201', stderr: "", exitCode: 0 });
		await requestRemoteDockerEngine("srv", "/volumes/create", { method: "POST", body: JSON.stringify({ Name: "cache", Driver: "local" }), unavailableData: {}, loggerScope: "t" });
		expect(vi.mocked(execRemoteCommand).mock.calls.at(-1)![0].command).toContain("-H 'Content-Type: application/json' -d '");
	});
});
