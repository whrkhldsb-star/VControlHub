import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PreferencesPageClient from "../preferences-page-client";
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

const serverPrefs = {
	defaultPage: "/",
	dashboardWidgets: ["quick-links", "analytics", "audit-log"],
	notificationsEnabled: true,
	notificationSound: true,
	autoRefreshInterval: 30,
};

describe("PreferencesPage", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.mocked(csrfFetch).mockReset();
		localStorage.clear();
		vi.useRealTimers();
		vi.mocked(csrfFetch).mockResolvedValue(serverPrefs);
	});

	it("surfaces preference load failures instead of silently showing defaults", async () => {
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("偏好接口不可用"));

		render(<PreferencesPageClient />);

		expect(await screen.findByRole("alert")).toHaveTextContent("偏好接口不可用");
		expect(screen.getByRole("button", { name: "仪表盘" })).toBeInTheDocument();
	});

	it("applies saved local preferences before the server round trip", () => {
		vi.mocked(csrfFetch).mockImplementation(() => new Promise(() => {}));
		localStorage.setItem(
			"vps-preferences",
			JSON.stringify({
				defaultPage: "/files",
				dashboardWidgets: ["server-status"],
				notificationsEnabled: true,
				notificationSound: false,
				autoRefreshInterval: 0,
			}),
		);

		render(<PreferencesPageClient />);

		expect(screen.getByRole("button", { name: "文件管理" })).toHaveClass("border-cyan-500/50");
		expect(screen.getByRole("switch", { name: "服务器状态" })).toHaveAttribute("aria-checked", "true");
		expect(screen.getByRole("switch", { name: "快捷入口" })).toHaveAttribute("aria-checked", "false");
	});

	it("renders dashboard widget toggles as accessible switches", async () => {
		render(<PreferencesPageClient />);

		expect(await screen.findByRole("switch", { name: "服务器状态" })).toHaveAttribute("aria-checked", "false");
		expect(screen.getByRole("switch", { name: "快捷入口" })).toHaveAttribute("aria-checked", "true");
	});

	it("does not render preference switches that are not consumed by the app", async () => {
		render(<PreferencesPageClient />);

		expect(await screen.findByRole("button", { name: "仪表盘" })).toBeInTheDocument();
		expect(screen.queryByText("紧凑模式")).not.toBeInTheDocument();
		expect(screen.queryByText("侧边栏默认收起")).not.toBeInTheDocument();
	});

	it("does not publish local preference side effects until the server save succeeds", async () => {
		const user = userEvent.setup();
		const dispatchSpy = vi.spyOn(window, "dispatchEvent");
		vi.mocked(csrfFetch)
			.mockResolvedValueOnce(serverPrefs)
			.mockRejectedValueOnce(new Error("偏好设置保存失败"));

		render(<PreferencesPageClient />);

		expect(await screen.findByRole("button", { name: "服务器管理" })).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "服务器管理" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("偏好设置保存失败");
		expect(JSON.parse(localStorage.getItem("vps-preferences") || "{}").defaultPage).toBe("/");
		expect(dispatchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: "vps-preferences-updated" }));
	});

	it("ignores a stale initial load response after the user saves newer preferences", async () => {
		const user = userEvent.setup();
		const dispatchSpy = vi.spyOn(window, "dispatchEvent");
		localStorage.setItem(
			"vps-preferences",
			JSON.stringify({
				defaultPage: "/files",
				dashboardWidgets: ["server-status"],
				notificationsEnabled: true,
				notificationSound: false,
				autoRefreshInterval: 0,
			}),
		);
		let resolveInitialLoad: ((value: typeof serverPrefs) => void) | undefined;
		vi.mocked(csrfFetch).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveInitialLoad = resolve as (value: typeof serverPrefs) => void;
				}),
		);
		vi.mocked(csrfFetch).mockResolvedValueOnce({ ...serverPrefs, defaultPage: "/servers" });

		render(<PreferencesPageClient />);

		expect(screen.getByRole("button", { name: "文件管理" })).toHaveClass("border-cyan-500/50");
		await user.click(screen.getByRole("button", { name: "服务器管理" }));
		expect(await screen.findByRole("status")).toHaveTextContent("设置已保存");

		resolveInitialLoad?.(serverPrefs);
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "服务器管理" })).toHaveClass("border-cyan-500/50");
		});
		expect(screen.getByRole("button", { name: "仪表盘" })).not.toHaveClass("border-cyan-500/50");
		expect(JSON.parse(localStorage.getItem("vps-preferences") || "{}").defaultPage).toBe("/servers");
		expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "vps-preferences-updated" }));
	});

	it("publishes preference updates after the server save confirms them", async () => {
		const user = userEvent.setup();
		const dispatchSpy = vi.spyOn(window, "dispatchEvent");
		vi.mocked(csrfFetch)
			.mockResolvedValueOnce(serverPrefs)
			.mockResolvedValueOnce({ ...serverPrefs, defaultPage: "/servers" });

		render(<PreferencesPageClient />);

		expect(await screen.findByRole("button", { name: "服务器管理" })).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "服务器管理" }));

		expect(await screen.findByRole("status")).toHaveTextContent("设置已保存");
		expect(JSON.parse(localStorage.getItem("vps-preferences") || "{}").defaultPage).toBe("/servers");
		expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "vps-preferences-updated" }));
	});
});
