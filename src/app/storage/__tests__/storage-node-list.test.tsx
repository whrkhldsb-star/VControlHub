import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkStorageNodeHealthActionMock } = vi.hoisted(() => ({
  checkStorageNodeHealthActionMock: vi.fn() }));

vi.mock("../actions", () => ({
  checkStorageNodeHealthAction: checkStorageNodeHealthActionMock,
  deleteStorageNodeAction: vi.fn() }));

vi.mock("./storage-node-edit-form", () => ({
  StorageNodeEditForm: () => React.createElement("div", null, "编辑表单") }));

vi.mock("./storage-node-delete-button", () => ({
  StorageNodeDeleteButton: () => React.createElement("button", { type: "button" }, "删除") }));

import { StorageNodeList } from "../storage-node-list";

describe("StorageNodeList health UI", () => {
  beforeEach(() => {
    checkStorageNodeHealthActionMock.mockReset();
  });

  it("shows health status, last check time, latency, error summary and can trigger a manual check", async () => {
    checkStorageNodeHealthActionMock.mockResolvedValueOnce({ success: "节点健康检查完成：健康" });

    render(
      <StorageNodeList
        canManageNodes={true}
        servers={[]}
        nodes={[
          {
            id: "node-1",
            name: "远端素材库",
            driver: "SFTP",
            basePath: "/data/root",
            isDefault: false,
            connectionSummary: "SFTP 存储：root@example:22，根目录 /data/root",
            directAccess: { mode: "managed-download", description: "受控下载", href: null },
            fileCount: 3,
            healthStatus: "UNHEALTHY",
            lastHealthCheckAt: "2026-05-05T12:00:00.000Z",
            lastHealthLatencyMs: 321,
            lastHealthError: "connect ECONNREFUSED" },
        ]}
      />,
    );

    expect(screen.getByText("异常")).toBeInTheDocument();
    expect(screen.getByText(/最近检测/)).toBeInTheDocument();
    expect(screen.getByText(/321 毫秒/)).toBeInTheDocument();
    expect(screen.getByText(/connect ECONNREFUSED/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "立即检测" }));

    await waitFor(() => expect(checkStorageNodeHealthActionMock).toHaveBeenCalledWith("node-1"));
    await waitFor(() => expect(screen.getByText("节点健康检查完成：健康")).toBeInTheDocument());
  });
});
