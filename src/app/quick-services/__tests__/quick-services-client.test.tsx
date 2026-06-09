import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuickServicesClient } from "../quick-services-client";
import { csrfFetch } from "@/lib/auth/csrf-client";

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));

const catalogResponse = {
	catalog: [
		{
			slug: "alist",
			name: "AList",
			category: "storage",
			icon: "📁",
			description: "File list",
			image: "xhofe/alist:latest",
			defaultPort: 5244,
			internalPort: 5244,
			path: "/",
			status: "running",
			id: "service_1",
			containerId: "container_1",
			port: 5244,
			error: null,
			source: "local",
		},
	],
	remoteCatalog: [],
	usedPorts: [5244],
	publicHost: "82.158.91.159",
};

const sourcesResponse = {
	sources: [
		{
			id: "src_1",
			name: "linuxserver",
			displayName: "LinuxServer.io",
			url: "https://example.com/apps.json",
			type: "json",
			enabled: true,
			lastSyncStatus: "success",
			lastSyncAt: "2026-01-01T00:00:00.000Z",
			lastSyncError: null,
			syncCount: 3,
		},
	],
};

function mockInitialLoads() {
	vi.mocked(csrfFetch)
		.mockResolvedValueOnce(catalogResponse)
		.mockResolvedValueOnce(sourcesResponse);
}

describe("QuickServicesClient", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.mocked(csrfFetch).mockReset();
	});

	it("opens an in-app confirmation dialog before uninstalling a service", async () => {
		const user = userEvent.setup();
		const confirmSpy = vi.spyOn(window, "confirm");
		mockInitialLoads();

		render(<QuickServicesClient canManage />);
		await user.click(await screen.findByRole("button", { name: /已安装/ }));
		await user.click(screen.getByRole("button", { name: "卸载" }));

		expect(confirmSpy).not.toHaveBeenCalled();
		const dialog = screen.getByRole("dialog", { name: "确认卸载快捷服务" });
		expect(dialog).toHaveTextContent("AList");
		expect(within(dialog).getByLabelText(/同时删除数据目录/)).not.toBeChecked();

		await user.click(within(dialog).getByRole("button", { name: "取消" }));
		expect(screen.queryByRole("dialog", { name: "确认卸载快捷服务" })).not.toBeInTheDocument();
		expect(csrfFetch).not.toHaveBeenCalledWith("/api/quick-services/alist", expect.objectContaining({ method: "DELETE" }));
	});

	it("confirms uninstall through the existing quick-service DELETE endpoint", async () => {
		const user = userEvent.setup();
		mockInitialLoads();
		vi.mocked(csrfFetch)
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce(catalogResponse);

		render(<QuickServicesClient canManage />);
		await user.click(await screen.findByRole("button", { name: /已安装/ }));
		await user.click(screen.getByRole("button", { name: "卸载" }));
		await user.click(screen.getByRole("button", { name: "确认卸载" }));

		await waitFor(() => {
			expect(csrfFetch).toHaveBeenCalledWith("/api/quick-services/alist", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ deleteVolumes: false }),
			});
		});
		expect(await screen.findByText("已卸载，数据目录已保留")).toBeInTheDocument();
	});

	it("confirms uninstall with optional service data directory removal", async () => {
		const user = userEvent.setup();
		mockInitialLoads();
		vi.mocked(csrfFetch)
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce(catalogResponse);

		render(<QuickServicesClient canManage />);
		await user.click(await screen.findByRole("button", { name: /已安装/ }));
		await user.click(screen.getByRole("button", { name: "卸载" }));
		const dialog = screen.getByRole("dialog", { name: "确认卸载快捷服务" });
		await user.click(within(dialog).getByLabelText(/同时删除数据目录/));
		await user.click(within(dialog).getByRole("button", { name: "确认卸载" }));

		await waitFor(() => {
			expect(csrfFetch).toHaveBeenCalledWith("/api/quick-services/alist", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ deleteVolumes: true }),
			});
		});
		expect(await screen.findByText("已卸载并删除数据目录")).toBeInTheDocument();
	});

	it("exposes a visible label for the catalog search instead of relying on placeholder text", async () => {
		const user = userEvent.setup();
		mockInitialLoads();

		render(<QuickServicesClient canManage />);

		const searchBox = await screen.findByRole("searchbox", { name: "搜索快捷服务" });
		expect(searchBox).toHaveAttribute("placeholder", "应用名称、描述、镜像…");
		await user.type(searchBox, "alist");
		expect(searchBox).toHaveValue("alist");
	});

	it("shows an update action for installed services and calls the update endpoint", async () => {
		const user = userEvent.setup();
		mockInitialLoads();
		vi.mocked(csrfFetch)
			.mockResolvedValueOnce({ success: true, status: "running", updated: true, health: "healthy", logTail: "service ready\nlistening on 5244" })
			.mockResolvedValueOnce(catalogResponse);

		render(<QuickServicesClient canManage />);
		await user.click(await screen.findByRole("button", { name: /已安装/ }));
		await user.click(screen.getByRole("button", { name: "更新" }));

		await waitFor(() => {
			expect(csrfFetch).toHaveBeenCalledWith("/api/quick-services/alist", expect.objectContaining({
				method: "PATCH",
				body: JSON.stringify({ action: "update" }),
			}));
		});
		expect(await screen.findByText(/更新完成，已拉取镜像并重建容器/)).toBeInTheDocument();
	expect(screen.getByText(/健康状态：healthy/)).toBeInTheDocument();
	expect(screen.getByText(/最近日志：service ready/)).toBeInTheDocument();
	});

	it("uses an in-app confirmation before deleting an app source", async () => {
		const user = userEvent.setup();
		const confirmSpy = vi.spyOn(window, "confirm");
		mockInitialLoads();

		render(<QuickServicesClient canManage />);
		await screen.findByText(/最近同步：LinuxServer/);
		await user.click(screen.getByRole("button", { name: /^⚙️ 应用源/ }));
		await user.click(screen.getByRole("button", { name: "删除" }));

		expect(confirmSpy).not.toHaveBeenCalled();
		const dialog = screen.getByRole("dialog", { name: "确认删除应用源" });
		expect(dialog).toHaveTextContent("LinuxServer.io");

		await user.click(within(dialog).getByRole("button", { name: "取消" }));
		expect(screen.queryByRole("dialog", { name: "确认删除应用源" })).not.toBeInTheDocument();
		expect(csrfFetch).not.toHaveBeenCalledWith("/api/app-sources?sourceId=src_1", expect.objectContaining({ method: "DELETE" }));
	});

	it("confirms app source deletion through the existing DELETE endpoint", async () => {
		const user = userEvent.setup();
		mockInitialLoads();
		vi.mocked(csrfFetch)
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ sources: [] })
			.mockResolvedValueOnce(catalogResponse);

		render(<QuickServicesClient canManage />);
		await screen.findByText(/最近同步：LinuxServer/);
		await user.click(screen.getByRole("button", { name: /^⚙️ 应用源/ }));
		await user.click(screen.getByRole("button", { name: "删除" }));
		await user.click(screen.getByRole("button", { name: "确认删除" }));

		await waitFor(() => {
			expect(csrfFetch).toHaveBeenCalledWith("/api/app-sources?sourceId=src_1", { method: "DELETE" });
		});
		expect(await screen.findByText("源已删除")).toBeInTheDocument();
	});

	it("shows a public direct-port access link for running services", async () => {
		mockInitialLoads();

		render(<QuickServicesClient canManage />);
		await userEvent.click(await screen.findByRole("button", { name: /已安装/ }));

		const accessLink = (await screen.findAllByRole("link", { name: /访问.*公开直连端口/ })).find((link) => link.getAttribute("title"));
		expect(accessLink).toHaveAttribute("href", "http://82.158.91.159:5244/");
		expect(accessLink).toHaveAttribute("title", expect.stringContaining("不经过 VControlHub 登录鉴权"));
		expect(await screen.findByText("公开直连端口")).toBeInTheDocument();
	});
});
