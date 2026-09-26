import { describe, expect, it, vi } from "vitest";
import http from "node:http";

/**
 * Boot-order guard for the custom server (src/server.ts).
 *
 * `node dist/server.js` is what production and every CI job that serves HTTP
 * (E2E, DAST) actually runs — a boot-time throw there kills the process before
 * it binds a port, and no unit test or typecheck sees it. Next's custom-server
 * API enforces ordering itself (`getUpgradeHandler()` throws
 * "prepare() must be called before performing this operation" before
 * prepare()), so this test reproduces that contract against the real module
 * and asserts src/server.ts satisfies it.
 */

const calls: string[] = [];
let prepared = false;

vi.mock("next", () => ({
	default: () => ({
		getRequestHandler: () => async () => undefined,
		prepare: async () => {
			prepared = true;
			calls.push("prepare");
		},
		getUpgradeHandler: () => {
			calls.push("getUpgradeHandler");
			// Same contract as next/dist/server/next.js: the underlying server
			// does not exist until prepare() has run.
			if (!prepared) {
				throw new Error("prepare() must be called before performing this operation");
			}
			return async () => undefined;
		},
	}),
}));

vi.mock("@/lib/ws/notification-ws", () => ({
	setupWebSocketServer: () => undefined,
	closeWebSocketServer: () => undefined,
}));

describe("custom server boot order", () => {
	it("reads Next's upgrade handler only after prepare()", async () => {
		// A Node built-in named import is not reliably replaced by vi.mock in
		// every Vitest/Node combination. Intercept the actual listen method so
		// this entrypoint test never binds the production port on a live host.
		const listen = vi.spyOn(http.Server.prototype, "listen").mockImplementation(function (this: http.Server) {
			return this;
		});
		// server.ts is a process entrypoint. Keep its lifecycle listeners from
		// escaping this test and intercepting a later Vitest worker error.
		const events = ["uncaughtException", "unhandledRejection", "SIGTERM", "SIGINT"] as const;
		const before = events.map((event) => new Set(process.listeners(event)));
		try {
			await import("../server");

			// main() is fire-and-forget; give its awaits a few ticks to settle.
			for (let i = 0; i < 50 && calls.length < 2; i += 1) {
				await new Promise((resolve) => setTimeout(resolve, 0));
			}

			expect(calls).toEqual(["prepare", "getUpgradeHandler"]);
		} finally {
			listen.mockRestore();
			for (const [index, event] of events.entries()) {
				for (const listener of process.listeners(event)) {
					if (!before[index]!.has(listener)) process.removeListener(event, listener);
				}
			}
		}
	});
});
