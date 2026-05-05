import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-session", () => ({
  requireSession: vi.fn().mockResolvedValue({
    userId: "u_1",
    username: "admin",
    roles: ["admin"],
    mustChangePassword: false,
  }),
}));

vi.mock("@/lib/server/service", () => ({
  listServerProfiles: vi.fn().mockResolvedValue([
    {
      id: "srv_1",
      name: "hk-prod-1",
      host: "203.0.113.10",
      port: 22,
      username: "root",
      connectionSummary: "root@203.0.113.10:22，使用 SSH 密钥 prod-root-key 连接",
      tags: ["prod"],
      enabled: true,
      sshKey: { id: "key_1", name: "prod-root-key", fingerprint: "SHA256:abc" },
    },
  ]),
}));

vi.mock("@/lib/storage/service", () => ({
  getStorageOverview: vi.fn().mockResolvedValue({
    nodes: [
      {
        id: "node_1",
        name: "主控本机",
        driver: "LOCAL",
        isDefault: true,
        connectionSummary: "本机存储：/srv/whrkhldsb/storage",
        directAccess: { mode: "managed-download", description: "本机文件由管理端直接提供受控下载与预览。" },
        fileCount: 3,
      },
      {
        id: "node_2",
        name: "香港媒体库",
        driver: "SFTP",
        isDefault: false,
        connectionSummary: "SFTP 存储：root@203.0.113.11:22（绑定节点 hk-media-1），根目录 /data/media",
        directAccess: { mode: "managed-download", description: "远端文件经管理端 SFTP 代理中转下载（来自 203.0.113.11:22）。", href: "/api/storage/sftp-download?nodeId=node_2&path=" },
        fileCount: 8,
      },
    ],
    entries: [
      {
        id: "file_1",
        name: "demo.mp4",
        mimeType: "video/mp4",
        relativePath: "videos/demo.mp4",
        sizeLabel: "1024 B",
        previewable: true,
        directAccess: { mode: "managed-download", description: "远端文件经管理端 SFTP 代理中转下载（来自 203.0.113.11:22）。", href: "/api/storage/sftp-download?nodeId=node_2&path=" },
        storageNode: { name: "香港媒体库" },
      },
    ],
    stats: {
      totalNodes: 2,
      defaultNodeName: "主控本机",
      localNodeCount: 1,
      sftpNodeCount: 1,
      totalEntries: 1,
      previewableEntries: 1,
    },
  }),
}));

import Home from "../page";

describe("Home", () => {
  it("renders dashboard sections for servers and storage overview", async () => {
    render(await Home());

    expect(screen.getByText("仪表盘")).toBeInTheDocument();
    expect(screen.getByText("VPS 节点")).toBeInTheDocument();
    expect(screen.getByText("存储节点")).toBeInTheDocument();
    expect(screen.getByText("文件管理")).toBeInTheDocument();
    expect(screen.getByText("远程下载")).toBeInTheDocument();
    expect(screen.getByText("审批中心")).toBeInTheDocument();
    expect(screen.getByText("最近审批活动")).toBeInTheDocument();
    expect(screen.getByText("最近操作日志")).toBeInTheDocument();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /查看全部/ })).toHaveAttribute("href", "/audit");
  });
});
