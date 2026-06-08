import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DockerPageClient from "../docker-page-client";
import { csrfFetch } from "@/lib/auth/csrf-client";

vi.mock("@/components/page-shell", () => ({
	PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
			return { data: [runningContainer] };
		});
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
});
