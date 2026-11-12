// @vitest-environment node
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ bin: "" }));

// A server managed through its Agent alone: no SSH credential is stored.
vi.mock("@/lib/ssh/server-target", () => ({
	loadEnabledServerForSsh: async (serverId: string) => ({
		server: { id: serverId, name: "agent-node" },
		ssh: { host: "203.0.113.10", port: 22, username: "root", agentServerId: serverId },
	}),
}));
// The Agent runs the command on the node and reports its output and exit status.
vi.mock("@/lib/server/agent-service", () => ({
	executeCommandWithAgent: async ({ command }: { command: string }) => {
		const result = spawnSync("sh", ["-c", command], { encoding: "utf8", env: { NODE_ENV: "test", PATH: `${host.bin}:/usr/bin:/bin` } });
		return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status ?? 1 };
	},
}));

import { isRemotePortAvailable } from "../docker-cli";

describe.skipIf(process.platform === "win32")("remote port probe on a server reached through its Agent", () => {
	let dir = "";
	beforeAll(() => {
		dir = mkdtempSync(path.join(tmpdir(), "vch-port-probe-"));
		host.bin = path.join(dir, "bin");
		mkdirSync(host.bin);
		// The node listens on 8080 (IPv4) and 9000 (IPv6).
		writeFileSync(path.join(host.bin, "ss"), "#!/bin/sh\nprintf 'LISTEN 0 128 0.0.0.0:8080 0.0.0.0:*\\nLISTEN 0 128 [::]:9000 [::]:*\\n'\n");
		chmodSync(path.join(host.bin, "ss"), 0o755);
	});
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	it("answers that a taken port is taken instead of failing", async () => {
		// The Agent transport reports a non-zero exit as a failed command. The
		// probe used to say "in use" with exit 1: it threw, and an install with
		// no fixed port stopped at the first taken candidate.
		await expect(isRemotePortAvailable("srv_agent", 8080)).resolves.toBe(false);
		await expect(isRemotePortAvailable("srv_agent", 9000)).resolves.toBe(false);
	});

	it("answers that a free port is free", async () => {
		await expect(isRemotePortAvailable("srv_agent", 8081)).resolves.toBe(true);
		// 80 is not 8080: the match is on the whole port.
		await expect(isRemotePortAvailable("srv_agent", 80)).resolves.toBe(true);
	});
});
