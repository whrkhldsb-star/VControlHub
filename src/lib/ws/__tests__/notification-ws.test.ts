import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import {
	closeWebSocketServer,
	getWsServer,
	setupWebSocketServer,
} from "../notification-ws";

describe("notification WebSocket lifecycle", () => {
	afterEach(() => {
		closeWebSocketServer();
	});

	it("clears the shared server instance during shutdown", () => {
		const server = createServer();
		setupWebSocketServer(server);

		expect(getWsServer()).not.toBeNull();
		closeWebSocketServer();
		expect(getWsServer()).toBeNull();
	});
});
