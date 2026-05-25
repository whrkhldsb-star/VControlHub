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

	it("shows an API error toast and keeps the template visible when deletion fails", async () => {
		const user = userEvent.setup();
		vi.spyOn(window, "confirm").mockReturnValue(true);
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("无权删除模板"));

		renderClient();

		await user.click(screen.getByRole("button", { name: "删除" }));

		await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/command-templates?id=tmpl_1", { method: "DELETE" }));
		expect(await screen.findByText("无权删除模板")).toBeInTheDocument();
		expect(screen.getByText("Docker Compose 更新")).toBeInTheDocument();
	});

	it("requires all template variables before submitting a command for approval", async () => {
		const user = userEvent.setup();

		renderClient();

		await user.click(screen.getByRole("button", { name: "一键下发" }));
		await user.click(screen.getByLabelText("生产 VPS"));
		await user.click(screen.getByRole("button", { name: "提交审批" }));

		expect(await screen.findByText("请填写变量 project_dir 后再提交审批")).toBeInTheDocument();
		expect(csrfFetch).not.toHaveBeenCalled();
	});

	it("keeps the deploy panel open and re-enables submit when command submission fails", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("审批服务不可用"));

		renderClient();

		await user.click(screen.getByRole("button", { name: "一键下发" }));
		await user.type(screen.getByPlaceholderText("project_dir"), "/srv/app");
		await user.click(screen.getByLabelText("生产 VPS"));
		await user.click(screen.getByRole("button", { name: "提交审批" }));

		expect(await screen.findByText("审批服务不可用")).toBeInTheDocument();
		expect(screen.getByPlaceholderText("project_dir")).toHaveValue("/srv/app");
		expect(screen.getByLabelText("生产 VPS")).toBeChecked();
		await waitFor(() => expect(screen.getByRole("button", { name: "提交审批" })).toBeEnabled());
	});
});
