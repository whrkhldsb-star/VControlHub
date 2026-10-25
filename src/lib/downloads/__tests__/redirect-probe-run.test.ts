// @vitest-environment node
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The real probe against a real HTTP server. It reads only the status and
 * Location of each hop and drops the body unread: undici reports an unread
 * body destroyed without a reason as RequestAbortedError ("Request aborted")
 * on the body's 'error' event, and with no listener that was an uncaught
 * exception — the first direct download in E2E took the whole server down.
 */
const target = vi.hoisted(() => ({ port: 0 }));
vi.mock("../source-url", () => ({
	assertDownloadSourceUrlSafe: async (url: string) => ({
		ok: true,
		resolution: { hostname: new URL(url).hostname, address: "127.0.0.1", port: target.port },
	}),
}));

import { resolveDownloadRedirects } from "../redirect-chain";

describe("redirect probe over HTTP", () => {
	let server: Server;
	let uncaught: unknown[] = [];
	const onUncaught = (error: unknown) => uncaught.push(error);

	beforeAll(async () => {
		server = createServer((request, response) => {
			const path = request.url ?? "/";
			if (path === "/hop") {
				response.writeHead(302, { location: `http://localhost:${target.port}/file.iso` });
				response.end();
				return;
			}
			if (path === "/head-refused" && request.method === "HEAD") {
				response.writeHead(405);
				response.end();
				return;
			}
			if (path === "/head-refused") {
				// One byte asked for; a larger body still in flight when dropped.
				response.writeHead(302, { location: `http://localhost:${target.port}/file.iso`, "content-length": "65536" });
				response.end(Buffer.alloc(65536));
				return;
			}
			response.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(8 * 1024 * 1024) });
			if (request.method === "HEAD") response.end();
			else response.end(Buffer.alloc(8 * 1024 * 1024));
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		target.port = (server.address() as AddressInfo).port;
		process.on("uncaughtException", onUncaught);
	});
	afterAll(async () => {
		process.off("uncaughtException", onUncaught);
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	async function settled() {
		// The body's error, if any, is emitted on a later turn.
		await new Promise((resolve) => setTimeout(resolve, 50));
	}

	it.each([
		["a file served directly", "/file.iso", "/file.iso"],
		["a redirect", "/hop", "/file.iso"],
		["a server refusing HEAD, answered by a one-byte GET", "/head-refused", "/file.iso"],
	])("follows %s without an uncaught error", async (_label, start, end) => {
		uncaught = [];
		const result = await resolveDownloadRedirects(`http://localhost:${target.port}${start}`);
		await settled();
		expect(result).toMatchObject({ ok: true, url: `http://localhost:${target.port}${end}` });
		expect(uncaught).toEqual([]);
	});
});
