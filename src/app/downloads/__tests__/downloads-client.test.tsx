import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DownloadsClient } from "../downloads-client";
import { csrfFetch } from "@/lib/auth/csrf-client";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

const servers = [
  { id: "srv_1", name: "主节点", host: "127.0.0.1", storagePath: "/root/downloads", storageDriver: "LOCAL" },
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
  server: { id: "srv_1", name: "主节点", host: "127.0.0.1" },
  creator: null,
};

describe("DownloadsClient", () => {
  beforeEach(() => {
    vi.mocked(csrfFetch).mockReset();
  });

  it("surfaces download list load failures instead of showing a misleading empty state", async () => {
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("下载列表加载失败"));

    render(<DownloadsClient servers={servers} canManage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("下载列表加载失败");
    expect(screen.queryByText("暂无下载任务")).not.toBeInTheDocument();
  });

  it("surfaces download action failures and keeps the task visible", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({ tasks: [runningTask], globalStat: null })
      .mockRejectedValueOnce(new Error("取消下载失败"));

    render(<DownloadsClient servers={servers} canManage />);

    expect(await screen.findByText("https://example.com/a.iso")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "✕ 取消" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("取消下载失败");
    expect(screen.getByText("https://example.com/a.iso")).toBeInTheDocument();
  });

  it("updates the visible task status from a successful manual refresh response", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({ tasks: [runningTask], globalStat: null })
      .mockResolvedValueOnce({ status: "COMPLETED", progress: "下载完成" });

    render(<DownloadsClient servers={servers} canManage />);

    expect(await screen.findByText("https://example.com/a.iso")).toBeInTheDocument();
    expect(screen.getAllByText("下载中").length).toBeGreaterThan(0);
    await actor.click(screen.getByRole("button", { name: "🔄 刷新" }));

    await screen.findAllByText("已完成");
    expect(screen.queryByText("0.1% ·")).not.toBeInTheDocument();
    expect(vi.mocked(csrfFetch)).toHaveBeenCalledTimes(2);
  });

  it("surfaces download create failures with backend details and keeps the form open", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({ tasks: [], globalStat: null })
      .mockRejectedValueOnce(new Error("目标路径不可写"));

    render(<DownloadsClient servers={servers} canManage />);

    await actor.click(await screen.findByRole("button", { name: "+ 新建下载" }));
    await actor.type(screen.getByPlaceholderText("https://example.com/file.zip 或 magnet:?xt=urn:btih:..."), "https://example.com/a.iso");
    await actor.click(screen.getByRole("button", { name: "开始下载" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("目标路径不可写");
    expect(screen.getByRole("heading", { name: "新建下载任务" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://example.com/a.iso")).toBeInTheDocument();
  });
});
