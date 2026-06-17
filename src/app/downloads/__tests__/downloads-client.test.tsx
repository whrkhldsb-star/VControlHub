import { screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DownloadsClient, type ServerOption } from "../downloads-client";
import { csrfFetch } from "@/lib/auth/csrf-client";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn() }));

const servers: ServerOption[] = [
  { id: "srv_1", name: "主节点", host: "127.0.0.1", storagePath: "/root/downloads", storageDriver: "LOCAL", directAccessMode: "PROXY", directAccessAvailable: false, accessTransport: "relay", accessStatusLabel: "当前：中转", accessDescription: "本机文件由管理端直接提供受控下载与预览。" },
];

const runningTask = {
  id: "dl_1",
  url: "https://example.com/a.iso",
  serverId: "srv_1",
  targetPath: "/root/downloads",
  fileName: "a.iso",
  status: "RUNNING",
  progress: null,
  pid: null,
  errorMessage: null,
  relayMode: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  aria2Gid: "gid_1",
  category: null,
  maxSpeedKb: null,
  totalBytes: "1000",
  completedBytes: "100",
  downloadSpeed: "10",
  fileSize: null,
  isBatch: false,
  batchUrls: null,
  downloadAccess: null,
  server: { id: "srv_1", name: "主节点", host: "127.0.0.1" },
  creator: null };

describe("DownloadsClient", () => {
  beforeEach(() => {
    vi.mocked(csrfFetch).mockReset();
  });

  it("surfaces download list load failures instead of showing a misleading empty state", async () => {
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("下载列表加载失败"));

    render(<DownloadsClient servers={servers} canManage canManageNode />);

    expect(await screen.findByRole("alert")).toHaveTextContent("下载列表加载失败");
    expect(screen.queryByText("暂无下载任务")).not.toBeInTheDocument();
  });

  it("surfaces download action failures and keeps the task visible", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({ tasks: [runningTask], globalStat: null })
      .mockRejectedValueOnce(new Error("取消下载失败"));

    render(<DownloadsClient servers={servers} canManage canManageNode />);

    expect(await screen.findByText("https://example.com/a.iso")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "✕ 取消" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("取消下载失败");
    expect(screen.getByText("https://example.com/a.iso")).toBeInTheDocument();
  });

  it("updates the visible task status from a successful manual refresh response", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({ tasks: [runningTask], globalStat: null })
      .mockResolvedValueOnce({
        status: "COMPLETED",
        progress: "下载完成",
        fileSize: "2048",
        totalBytes: "2048",
        completedBytes: "2048",
        downloadSpeed: "0",
        downloadAccess: {
          mode: "direct-url",
          transport: "direct",
          href: "/api/storage/direct-access?nodeId=store_1&path=downloads%2Fa.iso&download=1",
          fallbackHref: "/api/storage/sftp-download?nodeId=store_1&path=downloads%2Fa.iso&download=1",
          label: "下载文件",
          statusLabel: "当前：直连",
          description: "远端文件可切换为存储服务器直连（自动优先直连），不可用时回退到管理端 SFTP 中转。" } });

    render(<DownloadsClient servers={servers} canManage canManageNode />);

    expect(await screen.findByText("https://example.com/a.iso")).toBeInTheDocument();
    expect(screen.getAllByText("下载中").length).toBeGreaterThan(0);
    await actor.click(screen.getByRole("button", { name: "🔄 刷新" }));

    await screen.findAllByText("已完成");
    expect(screen.getByText("📦 2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("🔁 当前：直连")).toBeInTheDocument();
    const downloadLink = screen.getByRole("link", { name: "⬇ 下载文件" });
    expect(downloadLink).toHaveAttribute("href", "/api/storage/direct-access?nodeId=store_1&path=downloads%2Fa.iso&download=1");
    expect(screen.queryByText("0.1% ·")).not.toBeInTheDocument();
    expect(vi.mocked(csrfFetch)).toHaveBeenCalledTimes(2);
  });

  it("surfaces download create failures with backend details and keeps the form open", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({ tasks: [], globalStat: null })
      .mockRejectedValueOnce(new Error("目标路径不可写"));

    render(<DownloadsClient servers={servers} canManage canManageNode />);

    await actor.click(await screen.findByRole("button", { name: "+ 新建下载" }));
    await actor.type(screen.getByRole("textbox", { name: "下载链接" }), "https://example.com/a.iso");
    await actor.click(screen.getByRole("button", { name: "开始下载" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("目标路径不可写");
    expect(screen.getByRole("heading", { name: "新建下载任务" })).toBeInTheDocument();
    expect(screen.getByText("完成后的“下载文件”按钮和文件管理使用同一套访问策略。")).toBeInTheDocument();
    expect(screen.getByText("当前：中转")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://example.com/a.iso")).toBeInTheDocument();
  });

  it("prevents creating tasks when no eligible VPS target is available", async () => {
    vi.mocked(csrfFetch).mockResolvedValueOnce({ tasks: [], globalStat: null });

    render(<DownloadsClient servers={[]} canManage canManageNode />);

    expect(await screen.findByText("暂无可用下载目标：请先在 VPS 管理中为节点绑定存储并配置 SSH。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ 新建下载" })).not.toBeInTheDocument();
  });

  it("prevents mixed HTTP and magnet batch submissions on the client", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch).mockResolvedValueOnce({ tasks: [], globalStat: null });

    render(<DownloadsClient servers={servers} canManage canManageNode />);

    await actor.click(await screen.findByRole("button", { name: "+ 新建下载" }));
    await actor.click(screen.getByRole("button", { name: "📋 批量模式" }));
    await actor.type(
      screen.getByRole("textbox", { name: "下载链接（每行一个）" }),
      "https://example.com/a.zip\nmagnet:?xt=urn:btih:abcdef",
    );

    expect(screen.getByText("批量模式仅用于多个 HTTP/HTTPS 链接；磁力/BT 链接请单独创建任务，不要与普通链接混用。")).toBeInTheDocument();
    expect(screen.getByText("磁力/BT 链接请单独创建任务，不要与普通 HTTP/HTTPS 链接混用。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始下载" })).toBeDisabled();
    expect(vi.mocked(csrfFetch)).toHaveBeenCalledTimes(1);
  });
});
