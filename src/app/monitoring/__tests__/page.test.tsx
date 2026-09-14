import { act, screen, waitFor } from "@testing-library/react";
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
  Toolbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
  class MockStream {
    static instances: MockStream[] = [];
    listeners = new Map<string, (event: { data: string }) => void>();
    onerror: (() => void) | null = null;
    close = vi.fn();
    constructor() { MockStream.instances.push(this); }
    addEventListener(type: string, callback: (event: { data: string }) => void) { this.listeners.set(type, callback); }
    emit(value: unknown) { this.listeners.get("stats")?.({ data: JSON.stringify(value) }); }
  }
  beforeEach(() => {
    vi.mocked(csrfFetch).mockReset();
    window.localStorage.clear();
  });

  it("does not let a pending HTTP snapshot overwrite newer streamed metrics", async () => {
    MockStream.instances = [];
    vi.stubGlobal("EventSource", MockStream);
    let resolve!: (value: unknown) => void;
    vi.mocked(csrfFetch).mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<MonitoringPageClient />);
    await waitFor(() => expect(csrfFetch).toHaveBeenCalled());
    act(() => MockStream.instances[0]!.emit({ ...stats, hostname: "latest-stream" }));
    expect(screen.getByText("latest-stream")).toBeInTheDocument();
    await act(async () => { resolve(stats); });
    expect(screen.getByText("latest-stream")).toBeInTheDocument();
    expect(screen.queryByText("vps-1")).not.toBeInTheDocument();
  });

  it("retains usable metrics after malformed stream data and closes hidden streams", async () => {
    MockStream.instances = [];
    vi.stubGlobal("EventSource", MockStream);
    vi.mocked(csrfFetch).mockResolvedValue(stats);
    const view = render(<MonitoringPageClient />);
    expect(await screen.findByText("vps-1")).toBeInTheDocument();
    act(() => MockStream.instances[0]!.emit({ cpu: null }));
    expect(screen.getByText("vps-1")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("上次刷新失败");
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(MockStream.instances[0]!.close).toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(MockStream.instances).toHaveLength(2);
    act(() => MockStream.instances[0]!.emit({ ...stats, hostname: "obsolete-stream" }));
    expect(screen.queryByText("obsolete-stream")).not.toBeInTheDocument();
    view.unmount();
    expect(MockStream.instances[1]!.close).toHaveBeenCalled();
    visibility.mockRestore();
  });

  it("honors manual-only preferences without opening a stream", async () => {
    MockStream.instances = [];
    vi.stubGlobal("EventSource", MockStream);
    localStorage.setItem("vps-preferences", JSON.stringify({ autoRefreshInterval: 0 }));
    vi.mocked(csrfFetch).mockResolvedValue(stats);
    render(<MonitoringPageClient />);
    expect(await screen.findByText("vps-1")).toBeInTheDocument();
    expect(MockStream.instances).toHaveLength(0);
  });

  it("falls back to polling when the live connection stops delivering metrics", async () => {
    vi.useFakeTimers();
    MockStream.instances = [];
    vi.stubGlobal("EventSource", MockStream);
    vi.mocked(csrfFetch).mockResolvedValue(stats);
    const view = render(<MonitoringPageClient />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(csrfFetch).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(csrfFetch).toHaveBeenCalledTimes(2);
    act(() => MockStream.instances[0]!.emit({ ...stats, hostname: "recovered-stream" }));
    expect(screen.getByText("recovered-stream")).toBeInTheDocument();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends the loading state when the initial request never settles", async () => {
    vi.useFakeTimers();
    localStorage.setItem("vps-preferences", JSON.stringify({ autoRefreshInterval: 0 }));
    vi.mocked(csrfFetch).mockImplementation(() => new Promise(() => {}));
    const view = render(<MonitoringPageClient />);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_001); });
    expect(screen.getByRole("button", { name: "重试" })).toBeEnabled();
    expect(vi.mocked(csrfFetch).mock.calls[0]![1]?.signal?.aborted).toBe(true);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("surfaces the monitoring API error reason and lets operators retry", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockRejectedValueOnce(new Error("监控采集命令超时"))
      .mockResolvedValueOnce(stats);

    render(<MonitoringPageClient />);

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

    render(<MonitoringPageClient />);

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
