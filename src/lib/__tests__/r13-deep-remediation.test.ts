import { describe, expect, it, vi } from "vitest";

import { consumeProviderChatStream } from "@/lib/ai/chat-stream";
import { isSensitiveRemotePath } from "@/lib/ai/hosted-command-builder";
import { parseNetworkDeviceStats } from "@/lib/monitoring/traffic";
import { pythonGatewaySource } from "@/lib/server/direct-gateway";
import { parseMonitorScriptOutput } from "@/lib/server/monitor";
import { createSnippetSchema, listSnippetsQuerySchema } from "@/lib/snippet/schema";

vi.mock("@/lib/ssh/client", () => ({
	resolveRemoteRealPath: vi.fn(async ({ remotePath }: { remotePath: string }) => remotePath),
}));

import { assertSftpPathAccess } from "@/lib/ssh/sftp-access-control";

describe("R13 deep remediation regressions", () => {
	it("caps disk and network rows parsed from untrusted monitor output", () => {
		const diskLines = Array.from(
			{ length: 400 },
			(_, i) => `/dev/sd${i} 1000 500 500 50% /mnt/d${i}`,
		).join("\n");
		const netLines = Array.from(
			{ length: 120 },
			(_, i) => `eth${i}: 100 1 0 0 0 0 0 0 200 1 0 0 0 0 0 0`,
		).join("\n");
		const metrics = parseMonitorScriptOutput(
			`---DISK---\n${diskLines}\n---NET---\n${netLines}\n`,
		);
		expect(metrics.disk.length).toBeLessThanOrEqual(256);
		expect(metrics.network.length).toBeLessThanOrEqual(64);
	});

	it("caps parsed /proc/net/dev rows and rejects malformed lines", () => {
		const content = [
			"Inter-|   Receive |  Transmit",
			" face |bytes packets errs drop fifo frame compressed multicast|bytes packets",
			"badline: 1 2 3",
			`${"x".repeat(80)}: 1 0 0 0 0 0 0 0 2 0 0 0 0 0 0 0`,
			...Array.from(
				{ length: 100 },
				(_, i) => `eth${i}: ${i + 1} 0 0 0 0 0 0 0 ${i + 2} 0 0 0 0 0 0 0`,
			),
		].join("\n");
		const rows = parseNetworkDeviceStats(content);
		expect(rows.length).toBe(64);
		expect(rows[0]?.iface.length).toBe(64);
		expect(rows[1]?.iface).toBe("eth0");
	});

	it("bounds streamed AI provider content and reasoning in memory", async () => {
		const chunkText = "A".repeat(100_000);
		const sse = [
			`data: ${JSON.stringify({ choices: [{ delta: { content: chunkText, reasoning_content: chunkText } }] })}\n\n`,
			`data: ${JSON.stringify({ choices: [{ delta: { content: chunkText, reasoning_content: chunkText } }] })}\n\n`,
			`data: ${JSON.stringify({ choices: [{ delta: { content: chunkText, reasoning_content: chunkText } }] })}\n\n`,
			"data: [DONE]\n\n",
		].join("");
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(sse));
				controller.close();
			},
		});
		const state = await consumeProviderChatStream({
			body,
			providerType: "OPENAI",
			onEvent: () => {},
		});
		expect(state.content.length).toBe(250_000);
		expect(state.reasoning.length).toBe(250_000);
	});

	it("blocks sensitive secret paths in AI hosted read-only file commands", () => {
		expect(isSensitiveRemotePath("/srv/app/.env")).toBe(true);
		expect(isSensitiveRemotePath("/srv/app/prod.env")).toBe(true);
		expect(isSensitiveRemotePath("/etc/rancher/k3s/k3s.yaml")).toBe(true);
		expect(isSensitiveRemotePath("/run/secrets/db_password")).toBe(true);
		expect(isSensitiveRemotePath("/opt/infra/terraform.tfstate")).toBe(true);
		expect(isSensitiveRemotePath("/var/log/nginx/access.log")).toBe(false);
	});

	it("prevents restricted SFTP mutations of home root and login-control files", async () => {
		const restrictedSession = {
			userId: "u1",
			username: "op",
			roles: ["operator"],
			permissions: ["server:ssh"],
			currentTeamId: "t1",
			sessionVersion: 1,
		} as unknown as Parameters<typeof assertSftpPathAccess>[0]["session"];
		const target = {
			server: { operatingSystem: "LINUX" },
			ssh: { host: "127.0.0.1", port: 22, username: "ops" },
			rootPath: "/home/ops",
			homeVerified: true,
		} as unknown as NonNullable<Parameters<typeof assertSftpPathAccess>[0]["target"]>;

		for (const blocked of [
			"/home/ops",
			"/home/ops/.ssh/authorized_keys",
			"/home/ops/.bashrc",
			"/home/ops/.config/systemd/user/persist.service",
		]) {
			await expect(
				assertSftpPathAccess({
					session: restrictedSession,
					serverId: "s1",
					paths: [blocked],
					mutation: true,
					target,
				}),
			).rejects.toThrow();
		}

		await expect(
			assertSftpPathAccess({
				session: restrictedSession,
				serverId: "s1",
				paths: ["/home/ops/work/app.log"],
				mutation: true,
				target,
			}),
		).resolves.toBeDefined();
	});

	it("enforces schema bounds on snippet content, tags, and query filters", () => {
		expect(
			createSnippetSchema.safeParse({
				title: "ok",
				content: "x".repeat(200_001),
			}).success,
		).toBe(false);
		expect(
			createSnippetSchema.safeParse({
				title: "ok",
				content: "echo hi",
				tags: ["t".repeat(41)],
			}).success,
		).toBe(false);
		expect(listSnippetsQuerySchema.safeParse({ q: "a".repeat(121) }).success).toBe(false);
	});

	it("hardens python direct gateway canonical root comparison and hex signature validation", () => {
		const src = pythonGatewaySource();
		expect(src).toContain("CANONICAL_ROOT = os.path.realpath(ROOT)");
		expect(src).toContain('re.fullmatch(r"[0-9a-fA-F]{64}", signature)');
	});
});
