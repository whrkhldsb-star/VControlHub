import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
	listServerProfilesMock: vi.fn(),
}));

const defaultServer = {
	id: "srv_1",
	name: "hk-prod-1",
	host: "203.0.113.10",
	port: 22,
	username: "root",
	description: "primary node",
	tags: ["prod"],
	enabled: true,
	connectionSummary: "root@203.0.113.10:22，使用 SSH 密钥 prod-root-key 连接",
	sshKey: { id: "key_1", name: "prod-root-key", fingerprint: "SHA256:abc" },
	storageNode: { id: "node_1", name: "香港媒体库", driver: "SFTP", isDefault: false, basePath: "/data/media" },
	targetCount: 2,
	pendingCommandCount: 1,
	latestCommands: [
		{
			id: "cmd_1",
			title: "Restart nginx",
			initiatedByType: "ASSISTANT",
			requestStatus: "PENDING_APPROVAL",
			targetStatus: "PENDING_APPROVAL",
			createdAt: new Date(),
		},
	],
	connectionTypeLabel: "SSH 密钥",
	statusLabel: "已启用",
};


vi.mock("next/headers", () => ({
	cookies: vi.fn().mockResolvedValue({
		get: vi.fn().mockReturnValue({ value: "test-session-token" }),
	}),
}));

vi.mock("@/lib/auth/require-session", () => ({
	requireSession: vi.fn().mockResolvedValue({
		userId: "u_1",
		username: "admin",
		roles: ["admin"],
		mustChangePassword: false,
	}),
}));

vi.mock("@/lib/auth/authorization", () => ({
	sessionHasPermission: vi.fn().mockReturnValue(true),
}));

vi.mock("../actions", () => ({
	getServerFormOptions: vi.fn().mockResolvedValue({
		sshKeys: [{ id: "key_1", name: "prod-root-key", fingerprint: "SHA256:abc", description: null }],
	}),
	createSshKeyAction: vi.fn(),
	toggleServerAction: vi.fn(),
	batchToggleServerAction: vi.fn(),
	deleteServerAction: vi.fn(),
}));

vi.mock("../server-create-form", () => ({
	ServerCreateForm: ({ sshKeys }: { sshKeys: Array<{ id: string; name: string }> }) => (
		<div data-testid="server-create-form">表单密钥数：{sshKeys.length}</div>
	),
}));

vi.mock("@/lib/server/service", () => ({
	listServerProfiles: serviceMocks.listServerProfilesMock,
}));

import ServersPage from "../page";

describe("ServersPage", () => {
	it("renders managed server cards and management form", async () => {
		serviceMocks.listServerProfilesMock.mockResolvedValueOnce([defaultServer]);

		render(await ServersPage());

		expect(screen.getByRole("heading", { name: "VPS 管理" })).toBeInTheDocument();
		expect(screen.getAllByText("hk-prod-1").length).toBeGreaterThan(0);
		// "待审批：" and count are in separate spans; check the parent div contains both
		expect(screen.getByText("待审批：")).toBeInTheDocument();
		expect(screen.getByText("1", { selector: "span" })).toBeInTheDocument();
		expect(screen.getByText("prod-root-key")).toBeInTheDocument();
		expect(screen.getByTestId("server-create-form")).toHaveTextContent("表单密钥数：1");
	});

	it("renders password-connected server without ssh key metadata", async () => {
		serviceMocks.listServerProfilesMock.mockResolvedValueOnce([
			{
				...defaultServer,
				id: "srv_2",
				name: "local-node",
				host: "127.0.0.1",
				description: null,
				tags: [],
				connectionSummary: "root@127.0.0.1:22，使用密码连接",
				sshKey: null,
				storageNode: null,
				targetCount: 0,
				pendingCommandCount: 0,
				latestCommands: [],
				connectionTypeLabel: "密码",
			},
		]);

		render(await ServersPage());

		expect(screen.getAllByText("local-node").length).toBeGreaterThan(0);
		expect(screen.getByText("未绑定")).toBeInTheDocument();
		expect(screen.getByText("未配置")).toBeInTheDocument();
	});
});
