import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import MonitoringPageClient from "../monitoring-page-client";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

vi.mock("@/components/page-shell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  PageHeader: ({ eyebrow, title, description, children }: { eyebrow?: React.ReactNode; title?: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode }) => (
    <div>
      {eyebrow ? <p>{eyebrow}</p> : null}
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {children}
    </div>
  ),
  SurfacePanel: ({ title, children }: { title?: React.ReactNode; children: React.ReactNode }) => (
    <section>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  ),
}));

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

const stats = {
  hostname: "vps-1",
  platform: "linux",
  arch: "x64",
  uptime: "3 days",
  cpu: { model: "Intel Xeon Demo", cores: 4, usage: "12", loadAvg: ["0.1", "0.2", "0.3"] },
  memory: { total: "8 GB", used: "2 GB", free: "6 GB", usagePercent: "25" },
  disk: "20G / 100G",
  network: [{ iface: "eth0", rx: "1 MB", tx: "2 MB" }],
  topProcesses: [{ pid: "123", cpu: "1.0", mem: "2.0", cmd: "node server.js" }],
  tcpConnections: "42",
  timestamp: "2026-05-30 10:00:00",
};

describe("MonitoringPage", () => {
  beforeEach(() => {
    vi.mocked(csrfFetch).mockReset();
    window.localStorage.clear();
  });

  it("surfaces the monitoring API error reason and lets operators retry", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockRejectedValueOnce(new Error("监控采集命令超时"))
      .mockResolvedValueOnce(stats);

    render(<MonitoringPageClient canManage />);

    expect(await screen.findByText("无法获取监控数据")).toBeInTheDocument();
    expect(screen.getByText("监控采集命令超时")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => expect(screen.getByText("vps-1")).toBeInTheDocument());
    expect(vi.mocked(csrfFetch)).toHaveBeenCalledTimes(2);
  });

  it("keeps stale stats visible and shows a refresh failure reason", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce(stats)
      .mockRejectedValueOnce(new Error("刷新失败：权限不足"));

    render(<MonitoringPageClient canManage />);

    expect(await screen.findByText("vps-1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "刷新" }));

    expect(await screen.findByText(/上次刷新失败：刷新失败：权限不足/)).toBeInTheDocument();
    expect(screen.getByText("vps-1")).toBeInTheDocument();
  });

  it("keeps monitoring light-theme overrides in the CSS compatibility layer", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

    // Verify CSS variables exist (not hard-coded Q-layer fallbacks)
    expect(css).toContain("--warning-bg");
    expect(css).toContain("--danger-bg");
    expect(css).toContain("--success-bg");
    expect(css).toContain("--accent-bg");
    expect(css).toContain("--surface");
    expect(css).toContain("--text-primary");
  });
});
