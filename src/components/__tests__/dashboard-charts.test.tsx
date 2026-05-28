import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DashboardCharts } from "../dashboard-charts";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(async () => ({
    servers: [{ time: "2026-05-27T16:00:00.000Z", cpu: 12, memory: 34, disk: 56 }],
    downloads: [],
    audit: [],
    imageBed: [],
  })),
}));

describe("DashboardCharts", () => {
  it("renders a deterministic loading skeleton before client-side analytics load", async () => {
    render(<DashboardCharts />);

    expect(screen.getByTestId("dashboard-charts-loading")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("img", { name: "📈 服务器资源趋势（24h）" })).toBeInTheDocument();
    });
  });
});
