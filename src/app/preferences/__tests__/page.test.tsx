import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PreferencesPage from "../page";
import { csrfFetch } from "@/lib/auth/csrf-client";

vi.mock("@/components/page-shell", () => ({
	PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));

const serverPrefs = {
	sidebarCollapsed: false,
	defaultPage: "/",
	dashboardWidgets: ["quick-links", "analytics", "audit-log"],
	notificationsEnabled: true,
	notificationSound: true,
	autoRefreshInterval: 0,
	compactMode: false,
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

		render(<PreferencesPage />);

		expect(await screen.findByRole("alert")).toHaveTextContent("偏好接口不可用");
		expect(screen.getByRole("button", { name: "仪表盘" })).toBeInTheDocument();
	});

	it("shows an error and keeps the previous default page when saving preferences fails", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockResolvedValueOnce(serverPrefs).mockRejectedValueOnce(new Error("偏好设置保存失败"));

		render(<PreferencesPage />);

		expect(await screen.findByRole("button", { name: "服务器管理" })).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "服务器管理" }));

		await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith(
			"/api/preferences",
			expect.objectContaining({
				method: "PUT",
				body: expect.stringContaining('"defaultPage":"/servers"'),
			}),
		));
		expect(await screen.findByText("偏好设置保存失败")).toBeInTheDocument();
		expect(screen.queryByText("✓ 设置已保存")).not.toBeInTheDocument();
		expect(JSON.parse(localStorage.getItem("vps-preferences") || "{}").defaultPage).toBe("/");
	});
});
