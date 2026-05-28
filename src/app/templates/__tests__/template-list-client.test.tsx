import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast-provider";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { TemplateListClient } from "../template-list-client";

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));

const baseTemplate = {
	id: "tmpl_1",
	name: "Docker Compose 更新",
	description: "部署服务",
	command: "cd {{project_dir}} && docker compose up -d",
	variables: ["project_dir"],
	tags: ["deploy"],
	isBuiltin: false,
	createdAt: "2026-01-01T00:00:00.000Z",
	creator: { username: "admin", displayName: null },
};

function renderClient() {
	return render(
		<ToastProvider>
			<TemplateListClient
				templates={[baseTemplate]}
				servers={[{ id: "srv_1", name: "生产 VPS", enabled: true }]}
				canCreate={true}
			/>
		</ToastProvider>,
	);
}

describe("TemplateListClient", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.mocked(csrfFetch).mockReset();
	});

	it("uses an in-app confirmation before deleting a template", async () => {
		const user = userEvent.setup();
		const nativeConfirm = vi.spyOn(window, "confirm");
		vi.mocked(csrfFetch).mockResolvedValueOnce({ templates: [] });

		renderClient();

		await user.click(screen.getByRole("button", { name: "删除" }));

		expect(nativeConfirm).not.toHaveBeenCalled();
		expect(screen.getByRole("dialog", { name: "删除命令模板" })).toHaveTextContent("Docker Compose 更新");
		expect(csrfFetch).not.toHaveBeenCalled();

		await user.click(screen.getByRole("button", { name: "取消" }));
		expect(screen.queryByRole("dialog", { name: "删除命令模板" })).not.toBeInTheDocument();
		expect(csrfFetch).not.toHaveBeenCalled();

		await user.click(screen.getByRole("button", { name: "删除" }));
		await user.click(screen.getByRole("button", { name: "确认删除" }));

		await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/command-templates?id=tmpl_1", { method: "DELETE" }));
	});

	it("shows an API error toast and keeps the template visible when deletion fails", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("无权删除模板"));

		renderClient();

		await user.click(screen.getByRole("button", { name: "删除" }));
		await user.click(screen.getByRole("button", { name: "确认删除" }));

		await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/command-templates?id=tmpl_1", { method: "DELETE" }));
		expect(await screen.findByText("无权删除模板")).toBeInTheDocument();
		expect(screen.getAllByText("Docker Compose 更新").length).toBeGreaterThan(0);
	});

	it("requires all template variables before submitting a deployment", async () => {
		const user = userEvent.setup();

		renderClient();

		await user.click(screen.getByRole("button", { name: "一键下发" }));
		await user.click(screen.getByLabelText("生产 VPS"));
		await user.click(screen.getByRole("button", { name: "提交部署" }));

		expect(await screen.findByText("请填写变量 project_dir 后再提交部署")).toBeInTheDocument();
		expect(csrfFetch).not.toHaveBeenCalled();
	});

	it("keeps the deploy panel open and re-enables submit when deployment submission fails", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("部署服务不可用"));

		renderClient();

		await user.click(screen.getByRole("button", { name: "一键下发" }));
		await user.type(screen.getByPlaceholderText("project_dir"), "/srv/app");
		await user.click(screen.getByLabelText("生产 VPS"));
		await user.click(screen.getByRole("button", { name: "提交部署" }));

		expect(await screen.findByText("部署服务不可用")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("project_dir")).toHaveValue("/srv/app");
		expect(screen.getByLabelText("生产 VPS")).toBeChecked();
		await waitFor(() => expect(screen.getByRole("button", { name: "提交部署" })).toBeEnabled());
	});

	it("submits template launches through deployment runs", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockResolvedValueOnce({ id: "deploy_1" });

		renderClient();

		await user.click(screen.getByRole("button", { name: "一键下发" }));
		await user.type(screen.getByPlaceholderText("project_dir"), "/srv/app");
		await user.click(screen.getByLabelText("生产 VPS"));
		await user.click(screen.getByRole("button", { name: "提交部署" }));

		await waitFor(() =>
			expect(csrfFetch).toHaveBeenCalledWith(
				"/api/deployments",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({
						templateId: "tmpl_1",
						serverIds: ["srv_1"],
						variables: { project_dir: "/srv/app" },
						reason: "从模板中心下发：Docker Compose 更新",
					}),
				}),
			),
		);
		expect(await screen.findByText("部署已提交，可在部署记录中查看进度")).toBeInTheDocument();
	});
});
