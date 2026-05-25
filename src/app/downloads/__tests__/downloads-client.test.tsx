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
    vi.clearAllMocks();
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
});
