import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { describe, expect, it, vi } from "vitest";

import { DeploymentLaunchForm } from "../deployment-launch-form";

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));

const { loadTargets } = vi.hoisted(() => ({ loadTargets: vi.fn() }));
vi.mock("@/app/servers/inventory-actions", () => ({ loadServerOperationTargets: loadTargets }));

const servers = [
	{ id: "srv_1", name: "香港 VPS", host: "hk.example.test", username: "root" },
];

const templates = [
	{ id: "tmpl_1", name: "无变量部署", description: null, command: "systemctl restart nginx", variables: [] },
	{ id: "tmpl_2", name: "版本部署", description: "部署指定版本", command: "deploy {{app}} --version {{version}}", variables: ["app", "version"] },
];

describe("DeploymentLaunchForm", () => {
	it.each([true, false])("offers one-off dispatch in the zero-template state only with permission (%s)", canCreateCommand => {
		render(<DeploymentLaunchForm templates={[]} canCreateCommand={canCreateCommand} />, { locale: "en" });
		const link = screen.queryByRole("link", { name: "Run a one-off command" });
		if (canCreateCommand) expect(link).toHaveAttribute("href", "/commands"); else expect(link).toBeNull();
	});
	it("renders variable inputs for the selected deployment template", async () => {
		loadTargets.mockResolvedValue({ rows: servers, total: 1, enabledCount: 1, page: 1, pageSize: 24 });
		render(<DeploymentLaunchForm templates={templates} />);

		expect(screen.getByText("该模板没有变量，可直接选择目标 VPS 提交。")).toBeInTheDocument();

		fireEvent.change(screen.getByLabelText("部署模板"), { target: { value: "tmpl_2" } });

		expect(screen.getByLabelText("app")).toHaveAttribute("name", "variables.app");
		expect(screen.getByLabelText("version")).toHaveAttribute("name", "variables.version");
		expect(screen.getByText("部署指定版本")).toBeInTheDocument();
		expect(screen.getByText(/deploy <app> --version <version>/)).toBeInTheDocument();
		const serverList = screen.getByText("目标 VPS").closest("div")?.parentElement;
		expect(serverList).toBeTruthy();
		expect(await within(serverList as HTMLElement).findByText(/香港 VPS/)).toBeInTheDocument();
	});

	it("shows an actionable empty state when there are no enabled VPS targets", async () => {
		loadTargets.mockResolvedValue({ rows: [], total: 0, enabledCount: 0, page: 1, pageSize: 24 });
		render(<DeploymentLaunchForm templates={templates} />);

		expect(await screen.findByText("暂无可用 VPS，不能发起部署。")).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "去添加 VPS" })).toHaveAttribute("href", "/servers");
		expect(screen.queryByRole("button", { name: "提交部署审批" })).not.toBeInTheDocument();
	});
});
