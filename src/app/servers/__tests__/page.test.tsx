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
	toggleDirectGatewayAction: vi.fn(),
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
		expect(screen.getByText("VPS 状态优先")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "命令下发" })).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "命令下发" })).toHaveAttribute("href", "/requests");
		expect(screen.getAllByText("hk-prod-1").length).toBeGreaterThan(0);
		expect(screen.getByRole("region", { name: "VPS 状态总览" })).toBeInTheDocument();
		expect(screen.getAllByText("root@203.0.113.10:22，使用 SSH 密钥 prod-root-key 连接").length).toBeGreaterThan(0);
		// "待审批：" and count are in separate spans; check the parent div contains both
		expect(screen.getByText("待审批：")).toBeInTheDocument();
		expect(screen.getByText("1", { selector: "span" })).toBeInTheDocument();
		expect(screen.getByText("连接与状态")).toBeInTheDocument();
		expect(screen.getByText("操作与资源")).toBeInTheDocument();
		expect(screen.queryByText("节点操作")).not.toBeInTheDocument();
		expect(screen.queryByText("关联资源")).not.toBeInTheDocument();
		expect(screen.queryByTestId("server-create-form")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "添加 VPS" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "添加密钥" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "批量操作" })).toBeInTheDocument();
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
		expect(screen.getAllByText("未配置").length).toBeGreaterThan(0);
	});
});
