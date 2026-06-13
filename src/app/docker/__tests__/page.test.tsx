import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DockerPageClient from "../docker-page-client";
import { csrfFetch } from "@/lib/auth/csrf-client";

vi.mock("@/components/page-shell", () => ({
	PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	PageHeader: ({ eyebrow, title, description, children }: { eyebrow?: React.ReactNode; title?: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode }) => (
		<div>
			{eyebrow ? <p>{eyebrow}</p> : null}
			<h1>{title}</h1>
			{description ? <p>{description}</p> : null}
			{children}
		</div>
	),
}));

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));

const runningContainer = {
	Id: "container_1234567890",
	Names: ["/web"],
	Image: "nginx:latest",
	State: "running",
	Status: "Up 5 minutes",
	Ports: [],
	Labels: { "com.docker.compose.project": "site", "com.docker.compose.service": "web" },
};

describe("DockerPage", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.mocked(csrfFetch).mockReset();
		vi.mocked(csrfFetch).mockImplementation(async (input) => {
			const url = String(input);
			if (url.includes("stats=")) return {};
			return {
				data: [runningContainer],
				dockerScope: {
					scope: "hub-host",
					socketPath: "/var/run/docker.sock",
					warning: "Docker 模块仅操作 VControlHub 所在主机的 Docker socket，不是跨 VPS 容器控制台；具备 docker:manage 的用户等同拥有本机容器管理能力。",
				},
			};
		});
	});

	it("shows the hub-host Docker socket boundary before container actions", async () => {
		render(<DockerPageClient />);

		expect(await screen.findByText("web")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "运行边界：本机 Docker socket" })).toBeInTheDocument();
		expect(screen.getByText(/不是跨 VPS 容器控制台/)).toBeInTheDocument();
		expect(screen.getByText(/\/var\/run\/docker\.sock/)).toBeInTheDocument();
	});

	it("surfaces Docker action API errors instead of silently ignoring failures", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockImplementation(async (input, init) => {
			const url = String(input);
			if (url.includes("stats=")) return {};
			if (init && (init as RequestInit).method === "POST") throw new Error("Docker 权限不足");
			return { data: [runningContainer] };
		});

		render(<DockerPageClient />);

		expect(await screen.findByText("web")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "停止" }));

		await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith(
			"/api/docker/containers",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ id: "container_1234567890", action: "stop" }),
			}),
		));
		expect(await screen.findByText("Docker 权限不足")).toBeInTheDocument();
	});

	it("uses an in-app confirmation panel before removing a compose-managed container", async () => {
		const user = userEvent.setup();
		const confirmSpy = vi.spyOn(window, "confirm");

		render(<DockerPageClient />);

		expect(await screen.findByText("web")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "删除" }));

		expect(confirmSpy).not.toHaveBeenCalled();
		expect(screen.getByRole("dialog", { name: "确认删除容器" })).toBeInTheDocument();
		expect(screen.getByRole("dialog", { name: "确认删除容器" })).toHaveTextContent("即将删除容器 web");
		await user.click(screen.getByRole("button", { name: "取消" }));

		expect(screen.queryByRole("dialog", { name: "确认删除容器" })).not.toBeInTheDocument();
		expect(csrfFetch).not.toHaveBeenCalledWith(
			"/api/docker/containers",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ id: "container_1234567890", action: "remove" }),
			}),
		);
	});

	it("submits the remove action only after the in-app confirmation", async () => {
		const user = userEvent.setup();

		render(<DockerPageClient />);

		expect(await screen.findByText("web")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "删除" }));
		await user.click(screen.getByRole("button", { name: "确认删除" }));

		await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith(
			"/api/docker/containers",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ id: "container_1234567890", action: "remove" }),
			}),
		));
	});

	it("opens container logs as an accessible focus-managed dialog", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockImplementation(async (input) => {
			const url = String(input);
			if (url.includes("stats=")) return {};
			if (url.includes("logs=")) return { data: "server started\nready" };
			return { data: [runningContainer] };
		});

		render(<DockerPageClient />);

		expect(await screen.findByText("web")).toBeInTheDocument();
		const logsButton = screen.getByRole("button", { name: "日志" });
		await user.click(logsButton);

		const dialog = await screen.findByRole("dialog", { name: /容器日志/ });
		expect(dialog).toHaveAttribute("aria-modal", "true");
		expect(screen.getByText("server started", { exact: false })).toBeInTheDocument();
		await waitFor(() => expect(screen.getByRole("button", { name: "关闭容器日志" })).toHaveFocus());

		await user.keyboard("{Escape}");
		expect(screen.queryByRole("dialog", { name: /容器日志/ })).not.toBeInTheDocument();
		await waitFor(() => expect(logsButton).toHaveFocus());
	});

	it("exposes 44px touch targets on header and per-container action buttons (TR-022 R9)", async () => {
		vi.mocked(csrfFetch).mockImplementation(async (input) => {
			const url = String(input);
			if (url.includes("stats=")) return {};
			return { data: [runningContainer] };
		});

		render(<DockerPageClient />);
		expect(await screen.findByText("web")).toBeInTheDocument();

		const refreshList = screen.getByRole("button", { name: "刷新列表" });
		const refreshStats = screen.getByRole("button", { name: "刷新统计" });
		const autoRefresh = screen.getByRole("button", { name: /统计自动刷新/ });
		expect(refreshList.className).toContain("min-h-11");
		expect(refreshStats.className).toContain("min-h-11");
		expect(autoRefresh.className).toContain("min-h-11");

		const stopButton = screen.getByRole("button", { name: "停止" });
		const restartButton = screen.getByRole("button", { name: "重启" });
		const logsButton = screen.getByRole("button", { name: "日志" });
		const removeButton = screen.getByRole("button", { name: "删除" });
		expect(stopButton.className).toContain("min-h-11");
		expect(restartButton.className).toContain("min-h-11");
		expect(logsButton.className).toContain("min-h-11");
		expect(removeButton.className).toContain("min-h-11");
	});

	it("renders the logs and removal dialogs as mobile bottom sheets (TR-022 R9)", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockImplementation(async (input) => {
			const url = String(input);
			if (url.includes("stats=")) return {};
			if (url.includes("logs=")) return { data: "server started\nready" };
			return { data: [runningContainer] };
		});

		render(<DockerPageClient />);
		expect(await screen.findByText("web")).toBeInTheDocument();

		// Open the logs dialog and verify the scrollable backdrop is a mobile sheet
		await user.click(screen.getByRole("button", { name: "日志" }));
		const logsDialog = await screen.findByRole("dialog", { name: /容器日志/ });
		const logsBackdrop = logsDialog.parentElement as HTMLElement;
		// Backdrop must switch between items-end (mobile sheet) and sm:items-center (centered)
		expect(logsBackdrop.className).toMatch(/items-end/);
		expect(logsBackdrop.className).toMatch(/sm:items-center/);
		// The dialog itself must drop the fixed max-w on mobile (full-width sheet)
		expect(logsDialog.className).toMatch(/mx-0/);
		expect(logsDialog.className).toMatch(/sm:mx-4/);
		// Close the logs dialog
		await user.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByRole("dialog", { name: /容器日志/ })).not.toBeInTheDocument());

		// Open the removal dialog and verify the same mobile sheet shape
		await user.click(screen.getByRole("button", { name: "删除" }));
		const removalDialog = screen.getByRole("dialog", { name: "确认删除容器" });
		const removalBackdrop = removalDialog.parentElement as HTMLElement;
		expect(removalBackdrop.className).toMatch(/items-end/);
		expect(removalBackdrop.className).toMatch(/sm:items-center/);
		expect(removalDialog.className).toMatch(/mx-0/);
		expect(removalDialog.className).toMatch(/sm:mx-4/);
		// Confirm/cancel buttons in the removal dialog must hit 44px touch targets
		const cancelButton = screen.getByRole("button", { name: "取消" });
		const confirmButton = screen.getByRole("button", { name: "确认删除" });
		expect(cancelButton.className).toContain("min-h-11");
		expect(confirmButton.className).toContain("min-h-11");
	});
});
