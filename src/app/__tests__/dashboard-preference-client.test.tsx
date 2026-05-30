import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { DashboardPreferenceClient } from "../dashboard-preference-client";

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
});
