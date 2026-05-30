import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import MonitoringPage from "../page";
import { csrfFetch } from "@/lib/auth/csrf-client";

vi.mock("@/components/page-shell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
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

    render(<MonitoringPage />);

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

    render(<MonitoringPage />);

    expect(await screen.findByText("vps-1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "刷新" }));

    expect(await screen.findByText(/上次刷新失败：刷新失败：权限不足/)).toBeInTheDocument();
    expect(screen.getByText("vps-1")).toBeInTheDocument();
  });

  it("keeps monitoring light-theme overrides in the CSS compatibility layer", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

    expect(css).toContain("html.light .bg-amber-500\\/10");
    expect(css).toContain("html.light .bg-rose-500\\/10");
    expect(css).toContain("html.light .bg-emerald-500\\/10");
    expect(css).toContain("html.light .bg-cyan-500\\/10");
    expect(css).toContain("html.light .bg-slate-700\\/50");
    expect(css).toContain("html.light .text-amber-400");
    expect(css).toContain("html.light .text-rose-50");
  });
});
