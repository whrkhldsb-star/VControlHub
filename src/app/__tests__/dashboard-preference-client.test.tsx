import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { DashboardPreferenceClient } from "../dashboard-preference-client";

vi.mock("@/lib/i18n/use-locale", () => ({
	useI18n: () => ({
		t: (key: string) => key,
		locale: "zh" as const,
		setLocale: () => {},
		translations: {},
	}),
}));

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));

const csrfFetchMock = vi.mocked(csrfFetch);

function renderDashboardPreferenceClient() {
  render(
    <DashboardPreferenceClient>
      <section data-dashboard-widget="server-status">服务器状态</section>
      <section data-dashboard-widget="quick-links">快捷入口</section>
      <section data-dashboard-widget="analytics">数据趋势</section>
      <section data-dashboard-widget="audit-log">最近操作日志</section>
    </DashboardPreferenceClient>,
  );
}

describe("DashboardPreferenceClient", () => {
  beforeEach(() => {
    csrfFetchMock.mockReset();
    window.localStorage.clear();
    csrfFetchMock.mockResolvedValue({
      defaultPage: "/",
      dashboardWidgets: ["server-status", "quick-links", "analytics", "audit-log"],
      notificationsEnabled: true,
      notificationSound: true,
      autoRefreshInterval: 30,
    });
  });

  it("renders all dashboard widgets by default", async () => {
    renderDashboardPreferenceClient();

    expect(screen.getByText("服务器状态")).toBeInTheDocument();
    expect(screen.getByText("快捷入口")).toBeInTheDocument();
    expect(screen.getByText("数据趋势")).toBeInTheDocument();
    expect(screen.getByText("最近操作日志")).toBeInTheDocument();
    await waitFor(() => expect(csrfFetchMock).toHaveBeenCalledWith("/api/preferences"));
    expect(document.querySelector("style")?.textContent ?? "").toBe("");
  });

  it("applies local dashboard widget preferences before the server round trip", () => {
    csrfFetchMock.mockImplementation(() => new Promise(() => {}));
    window.localStorage.setItem("vps-preferences", JSON.stringify({ dashboardWidgets: ["quick-links"] }));

    renderDashboardPreferenceClient();

    expect(document.querySelector("style")?.textContent).toContain('[data-dashboard-widget="server-status"]{display:none}');
    expect(document.querySelector("style")?.textContent).toContain('[data-dashboard-widget="analytics"]{display:none}');
    expect(document.querySelector("style")?.textContent).toContain('[data-dashboard-widget="audit-log"]{display:none}');
  });

  it("enters edit mode, toggles widget visibility, and writes the order on done", async () => {
    csrfFetchMock.mockResolvedValue({
      defaultPage: "/",
      dashboardWidgets: ["server-status", "quick-links", "analytics", "audit-log"],
      notificationsEnabled: true,
      notificationSound: true,
      autoRefreshInterval: 30,
    });

    renderDashboardPreferenceClient();
    // Wait for the server preferences to be applied (otherwise we might race the
    // initial useEffect-driven load).
    await waitFor(() => expect(csrfFetchMock).toHaveBeenCalledWith("/api/preferences"));

    // Enter edit mode via the toolbar's edit button.
    fireEvent.click(screen.getByRole("button", { name: "dashboard.customize-edit" }));

    // Edit-mode toolbar is up: drag-tip + per-widget toggles + reset + done.
    expect(screen.getByTestId("toggle-widget-server-status")).toBeInTheDocument();
    expect(screen.getByTestId("customize-done")).toBeInTheDocument();

    // Hide analytics.
    fireEvent.click(screen.getByTestId("toggle-widget-analytics"));

    // Hit done: PUT /api/preferences should be called with the visible order
    // (analytics filtered out).
    fireEvent.click(screen.getByTestId("customize-done"));

    await waitFor(() => {
      const putCall = csrfFetchMock.mock.calls.find(([url, init]) => {
        return url === "/api/preferences" && (init as RequestInit | undefined)?.method === "PUT";
      });
      expect(putCall).toBeDefined();
    });
    const putCall = csrfFetchMock.mock.calls.find(([url, init]) => {
      return url === "/api/preferences" && (init as RequestInit | undefined)?.method === "PUT";
    });
    const init = putCall?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(init?.body))).toEqual({
      dashboardWidgets: ["server-status", "quick-links", "audit-log"],
    });
  });

  it("clicking a widget in view mode opens the detail dialog", async () => {
    csrfFetchMock.mockResolvedValue({
      defaultPage: "/",
      dashboardWidgets: ["server-status", "quick-links", "analytics", "audit-log"],
      notificationsEnabled: true,
      notificationSound: true,
      autoRefreshInterval: 30,
    });

    renderDashboardPreferenceClient();
    await waitFor(() => expect(csrfFetchMock).toHaveBeenCalledWith("/api/preferences"));

    // In view mode, clicking the server-status widget should open the dialog.
    fireEvent.click(screen.getByText("服务器状态"));
    expect(screen.getByTestId("dashboard-widget-detail-dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("VPS 状态");
  });

  it("reset restores the default widget order in edit mode", async () => {
    csrfFetchMock.mockResolvedValue({
      defaultPage: "/",
      dashboardWidgets: ["quick-links", "server-status"], // user-prefs from server
      notificationsEnabled: true,
      notificationSound: true,
      autoRefreshInterval: 30,
    });

    renderDashboardPreferenceClient();
    await waitFor(() => expect(csrfFetchMock).toHaveBeenCalledWith("/api/preferences"));

    // Enter edit mode.
    fireEvent.click(screen.getByRole("button", { name: "dashboard.customize-edit" }));

    // Hit reset.
    fireEvent.click(screen.getByRole("button", { name: "dashboard.customize-reset" }));

    // Now click done — PUT body should reflect the default order (DASHBOARD_WIDGET_IDS).
    fireEvent.click(screen.getByTestId("customize-done"));

    await waitFor(() => {
      const putCall = csrfFetchMock.mock.calls.find(([url, init]) => {
        return url === "/api/preferences" && (init as RequestInit | undefined)?.method === "PUT";
      });
      expect(putCall).toBeDefined();
    });
    const putCall = csrfFetchMock.mock.calls.find(([url, init]) => {
      return url === "/api/preferences" && (init as RequestInit | undefined)?.method === "PUT";
    });
    const init = putCall?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(init?.body))).toEqual({
      dashboardWidgets: ["server-status", "quick-links", "analytics", "audit-log"],
    });
  });
});
