import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadSshWsRuntimeEnv, resolveSshWsListenConfig } from "../ssh-ws-proxy";

describe("resolveSshWsListenConfig", () => {
	it("defaults to loopback host and port 3001", () => {
		expect(resolveSshWsListenConfig({})).toEqual({ host: "127.0.0.1", port: 3001 });
	});

	it("honors portable host and port environment overrides", () => {
		expect(resolveSshWsListenConfig({ SSH_WS_HOST: "0.0.0.0", SSH_WS_PORT: "3101" })).toEqual({
			host: "0.0.0.0",
			port: 3101,
		});
	});

	it("rejects invalid port values clearly", () => {
		expect(() => resolveSshWsListenConfig({ SSH_WS_PORT: "not-a-port" })).toThrow("SSH_WS_PORT must be a valid TCP port");
		expect(() => resolveSshWsListenConfig({ SSH_WS_PORT: "70000" })).toThrow("SSH_WS_PORT must be a valid TCP port");
	});

	it("does not retain the legacy raw secret query-parameter check", async () => {
		const source = await readFile(path.resolve(__dirname, "../ssh-ws-proxy.ts"), "utf8");
		expect(source).toContain('url.searchParams.get("handshake")');
		expect(source).toContain("verifySshWsHandshakeToken");
		expect(source).not.toContain('url.searchParams.get("secret")');
	});

	it("loads SSH runtime env files when the process starts with a minimal environment", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "ssh-ws-env-"));
		const previousSecret = process.env.SSH_WS_SECRET;
		const previousOrigins = process.env.SSH_WS_ALLOWED_ORIGINS;

		delete process.env.SSH_WS_SECRET;
		delete process.env.SSH_WS_ALLOWED_ORIGINS;

		try {
			await writeFile(
				path.join(tempDir, ".env.runtime"),
				'SSH_WS_SECRET="runtime-secret"\nSSH_WS_ALLOWED_ORIGINS="https://ci.example.test,http://localhost:3000"\n',
			);
			loadSshWsRuntimeEnv(tempDir);

			expect(process.env.SSH_WS_SECRET).toBe("runtime-secret");
			expect(process.env.SSH_WS_ALLOWED_ORIGINS).toContain("ci.example.test");
		} finally {
			await rm(tempDir, { force: true, recursive: true });
			if (previousSecret === undefined) delete process.env.SSH_WS_SECRET;
			else process.env.SSH_WS_SECRET = previousSecret;
			if (previousOrigins === undefined) delete process.env.SSH_WS_ALLOWED_ORIGINS;
			else process.env.SSH_WS_ALLOWED_ORIGINS = previousOrigins;
		}
	});

	it("keeps idle browser SSH sessions alive with WebSocket ping/pong and tolerant SSH keepalives", async () => {
		const source = await readFile(path.resolve(__dirname, "../ssh-ws-proxy.ts"), "utf8");
		expect(source).toContain("SSH_WS_HEARTBEAT_INTERVAL_MS");
		expect(source).toContain("getSshTerminalRuntimeConfig");
		expect(source).toContain("terminalRuntimeConfig.sshKeepaliveIntervalMs");
		expect(source).toContain("terminalRuntimeConfig.sshKeepaliveCountMax");
		expect(source).toContain("client.ping()");
		expect(source).toContain('ws.on("pong"');
		expect(source).toContain("SSH_KEEPALIVE_COUNT_MAX");
		expect(source).toContain('process.env.SSH_KEEPALIVE_COUNT_MAX || "60"');
		expect(source).not.toContain("keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS");
		expect(source).not.toContain("keepaliveCountMax: 3");
	});
});
