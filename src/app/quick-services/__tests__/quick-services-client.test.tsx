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
};

const sourcesResponse = { sources: [] };

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
			expect(csrfFetch).toHaveBeenCalledWith("/api/quick-services/alist", { method: "DELETE" });
		});
		expect(await screen.findByText("已卸载")).toBeInTheDocument();
	});
});
