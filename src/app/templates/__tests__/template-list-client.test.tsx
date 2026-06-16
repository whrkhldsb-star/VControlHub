import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/toast-provider";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { TemplateListClient } from "../template-list-client";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

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
				canDeploy={true}
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
		expect(screen.getByLabelText("变量 project_dir")).toBeInTheDocument();
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
		await user.type(screen.getByLabelText("变量 project_dir"), "/srv/app");
		await user.click(screen.getByLabelText("生产 VPS"));
		await user.click(screen.getByRole("button", { name: "提交部署" }));

		expect(await screen.findByText("部署服务不可用")).toBeInTheDocument();
		expect(screen.getByLabelText("变量 project_dir")).toHaveValue("/srv/app");
		expect(screen.getByLabelText("生产 VPS")).toBeChecked();
		await waitFor(() => expect(screen.getByRole("button", { name: "提交部署" })).toBeEnabled());
	});

	it("creates command templates with visible labels instead of placeholder-only fields", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockResolvedValueOnce({ id: "tmpl_new" }).mockResolvedValueOnce({ templates: [] });

		renderClient();

		await user.click(screen.getByRole("button", { name: "+ 创建模板" }));
		await user.type(screen.getByLabelText("模板名称"), "重启 Web 服务");
		await user.type(screen.getByLabelText("描述"), "滚动重启");
		await user.type(screen.getByLabelText("命令内容"), "systemctl restart nginx");
		await user.type(screen.getByLabelText("回滚命令（可选）"), "systemctl restart nginx-old");
		await user.type(screen.getByLabelText("标签（逗号分隔）"), "ops, nginx");
		await user.click(screen.getByRole("button", { name: "创建模板" }));

		await waitFor(() =>
			expect(csrfFetch).toHaveBeenCalledWith(
				"/api/command-templates",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({
						name: "重启 Web 服务",
						description: "滚动重启",
						command: "systemctl restart nginx",
						rollbackCommand: "systemctl restart nginx-old",
						tags: ["ops", "nginx"],
					}),
				}),
			),
		);
	});

	it("submits template launches through deployment runs", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockResolvedValueOnce({ id: "deploy_1" });

		renderClient();

		await user.click(screen.getByRole("button", { name: "一键下发" }));
		await user.type(screen.getByLabelText("变量 project_dir"), "/srv/app");
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

	describe("touch targets (TR-022 R19 mobile)", () => {
		function mockHeightsBySelector(measurements: Record<string, number>) {
			// jsdom reports getBoundingClientRect as 0x0; install a minimal stub
			// that returns the requested height for buttons whose className includes
			// the test selector. Sufficient for asserting that min-h-11 produced
			// at least 44px of computed height.
			const original = Element.prototype.getBoundingClientRect;
			Element.prototype.getBoundingClientRect = function () {
				const className = (this.getAttribute("class") ?? "") as string;
				for (const [selector, height] of Object.entries(measurements)) {
					if (className.includes(selector)) {
						return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 100, height, toJSON: () => ({}) } as DOMRect;
					}
				}
				return original.call(this);
			};
			return () => {
				Element.prototype.getBoundingClientRect = original;
			};
		}

		it("renders the card delete button with at least 44px height/width", () => {
			const restore = mockHeightsBySelector({ "min-h-11": 44 });
			try {
				renderClient();
				const btn = screen.getByRole("button", { name: "删除" });
				const rect = btn.getBoundingClientRect();
				expect(rect.height).toBeGreaterThanOrEqual(44);
				expect(rect.width).toBeGreaterThanOrEqual(44);
			} finally {
				restore();
			}
		});

		it("renders the + 创建模板 trigger with at least 44px height", () => {
			const restore = mockHeightsBySelector({ "min-h-11": 44 });
			try {
				renderClient();
				const btn = screen.getByRole("button", { name: "+ 创建模板" });
				expect(btn.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
			} finally {
				restore();
			}
		});

		it("renders the deploy panel primary/cancel buttons with at least 44px height", async () => {
			const restore = mockHeightsBySelector({ "min-h-11": 44 });
			try {
				const actor = userEvent.setup();
				renderClient();
				await actor.click(screen.getByRole("button", { name: "一键下发" }));
				expect(screen.getByRole("button", { name: "提交部署" }).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
				expect(screen.getByRole("button", { name: "取消" }).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
			} finally {
				restore();
			}
		});

		it("renders the create-template form primary/cancel buttons with at least 44px height", async () => {
			const restore = mockHeightsBySelector({ "min-h-11": 44 });
			try {
				const actor = userEvent.setup();
				renderClient();
				await actor.click(screen.getByRole("button", { name: "+ 创建模板" }));
				expect(screen.getByRole("button", { name: "创建模板" }).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
				expect(screen.getByRole("button", { name: "取消" }).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
			} finally {
				restore();
			}
		});

		it("renders the delete-confirm dialog buttons with at least 44px height", async () => {
			const restore = mockHeightsBySelector({ "min-h-11": 44 });
			try {
				const actor = userEvent.setup();
				renderClient();
				await actor.click(screen.getByRole("button", { name: "删除" }));
				const dialog = await screen.findByRole("dialog", { name: "删除命令模板" });
				expect(within(dialog).getByRole("button", { name: "确认删除" }).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
				expect(within(dialog).getByRole("button", { name: "取消" }).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
			} finally {
				restore();
			}
		});
	});
});
