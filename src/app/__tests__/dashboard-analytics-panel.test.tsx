import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { I18nProvider } from "@/lib/i18n/provider";
import { DashboardAnalyticsPanel } from "../dashboard-analytics-panel";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

const csrfFetchMock = vi.mocked(csrfFetch);

function renderPanel(locale: "zh" | "en" = "zh") {
  return render(
    <I18nProvider initialLocale={locale}>
      <DashboardAnalyticsPanel />
    </I18nProvider>,
  );
}

describe("DashboardAnalyticsPanel", () => {
  beforeEach(() => {
    csrfFetchMock.mockReset();
  });

  it("loads the dashboard analytics API and renders operational trends", async () => {
    csrfFetchMock.mockResolvedValue({
      servers: [{ time: "2026-01-01T00:00:00.000Z", cpu: 12, memory: 34, disk: 56 }],
      downloads: [{ date: "2026-01-01", completed: 2, failed: 1, running: 1, pending: 0 }],
      audit: [{ date: "2026-01-01", total: 3 }],
      imageBed: [{ date: "2026-01-01", count: 4, size: 4096 }],
    });

    renderPanel();

    expect(screen.getByText("正在加载趋势…")).toBeInTheDocument();

    await waitFor(() => expect(csrfFetchMock).toHaveBeenCalledWith("/api/dashboard/analytics?type=all"));
    expect(await screen.findByText("数据趋势")).toBeInTheDocument();
    expect(screen.getByText("VPS 资源趋势（24h）")).toBeInTheDocument();
    expect(screen.getByTestId("server-analytics-chart")).toHaveTextContent("CPU");
    expect(screen.getByTestId("server-analytics-chart")).toHaveTextContent("56%");
    expect(screen.getByTestId("download-analytics-chart")).toHaveTextContent("完成");
    expect(screen.getByTestId("download-analytics-chart")).toHaveTextContent("失败");
    expect(screen.getAllByText((_content, element) => element?.textContent?.includes("最近累计 4 张 / 4.0 KB") ?? false).length).toBeGreaterThan(0);
  });

  it("shows an actionable inline error when the analytics API fails", async () => {
    csrfFetchMock.mockRejectedValue(new Error("analytics unavailable"));

    renderPanel();

    expect(await screen.findByRole("alert")).toHaveTextContent("趋势数据暂不可用: analytics unavailable");
  });

  it("uses the active locale for dashboard analytics labels", async () => {
    csrfFetchMock.mockResolvedValue({
      servers: [],
      downloads: [],
      audit: [],
      imageBed: [],
    });

    renderPanel("en");

    expect(await screen.findByText("Data Trends")).toBeInTheDocument();
    expect(screen.getByText("VPS resource trend (24h)")).toBeInTheDocument();
    expect(screen.getByText("No node metric snapshots yet.")).toBeInTheDocument();
    expect(screen.getByText("Download task trend (7d)")).toBeInTheDocument();
    expect(screen.getByText("No download tasks in the last 7 days.")).toBeInTheDocument();
    expect(screen.queryByText("数据趋势")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无节点指标快照。")).not.toBeInTheDocument();
  });
});
