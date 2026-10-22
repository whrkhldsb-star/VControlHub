// @vitest-environment node
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({
	createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { requestDockerEngine } from "../engine-client";

/**
 * A daemon connection that drops after the headers and part of the body
 * never ends the response, and the request's idle timeout no longer applies:
 * the container list waited forever. A real local HTTP server cuts it off.
 */
describe("local Docker Engine response cut off", () => {
	let server: Server;
	beforeAll(async () => {
		server = createServer((request, response) => {
			response.writeHead(200, { "Content-Type": "application/json", "Content-Length": "1000" });
			response.write("[{\"Id\":");
			setTimeout(() => request.socket.destroy(), 20);
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		vi.stubEnv("DOCKER_HOST", `tcp://127.0.0.1:${(server.address() as AddressInfo).port}`);
	});
	afterAll(async () => {
		vi.unstubAllEnvs();
		await new Promise((resolve) => server.close(resolve));
	});

	it("settles with an error instead of hanging", async () => {
		const outcome = await Promise.race([
			requestDockerEngine("/containers/json", { unavailableData: [], loggerScope: "test", timeoutMs: 100 }),
			new Promise((resolve) => setTimeout(() => resolve("still waiting"), 1_000)),
		]);
		expect(outcome).toMatchObject({ ok: false, status: 502 });
	});
});
