import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { RecentDownloadsPanel } from "../recent-downloads-panel";

const downloads = [{
  id: "task_1",
  fileName: "app.zip",
  path: "releases/2026",
  completedAt: "2026-07-14T10:00:00.000Z",
  storageNode: { id: "node_2", name: "东京存储", driver: "SFTP" },
}];

describe("RecentDownloadsPanel", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));

  it("loads recent downloads and navigates the file SPA to the matching node directory", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ downloads }) } as Response);
    const onNavigate = vi.fn();

    renderWithI18n(<RecentDownloadsPanel onNavigate={onNavigate} />, { locale: "zh" });

    expect(screen.getByText("正在加载最近下载…")).toBeVisible();
    expect(await screen.findByRole("button", { name: /app\.zip/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /app\.zip/ }));

    expect(onNavigate).toHaveBeenCalledWith("releases/2026", "node_2");
  });

  it("shows empty and error states and supports refresh", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ downloads: [] }) } as Response)
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "boom" }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ downloads }) } as Response);

    renderWithI18n(<RecentDownloadsPanel onNavigate={vi.fn()} />, { locale: "zh" });
    expect(await screen.findByText("暂无最近完成的下载")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "刷新最近下载" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("最近下载加载失败");

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /app\.zip/ })).toBeVisible());
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("renders English copy", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ downloads: [] }) } as Response);
    renderWithI18n(<RecentDownloadsPanel onNavigate={vi.fn()} />, { locale: "en" });
    expect(await screen.findByText("No recently completed downloads")).toBeVisible();
    expect(screen.getByRole("button", { name: "Refresh recent downloads" })).toBeVisible();
  });
});
