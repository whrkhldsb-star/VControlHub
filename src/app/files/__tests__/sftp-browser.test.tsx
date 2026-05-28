import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { csrfFetchMock } = vi.hoisted(() => ({
  csrfFetchMock: vi.fn(),
}));

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: csrfFetchMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { SftpBrowser } from "../sftp-browser";

describe("SftpBrowser", () => {
  beforeEach(() => {
    csrfFetchMock.mockReset();
  });

  it("loads remote files from the canonical storage SFTP API when a node is selected", async () => {
    csrfFetchMock.mockResolvedValueOnce({
      nodeId: "node_1",
      nodeName: "香港媒体库",
      remotePath: "/",
      entries: [
        { name: "app.log", longname: "-rw-r--r-- app.log", type: "file", size: 128, modifyTime: 1_700_000_000_000, accessTime: 1_700_000_000_000 },
      ],
    });

    render(<SftpBrowser sftpNodes={[{ id: "node_1", name: "香港媒体库", driver: "SFTP" }]} />);

    await userEvent.selectOptions(screen.getByLabelText("节点"), "node_1");

    await waitFor(() => {
      expect(csrfFetchMock).toHaveBeenCalledWith("/api/storage/sftp?nodeId=node_1&path=%2F");
    });
    const matches = await screen.findAllByText(/app\.log/);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("uses the bound server id for Direct Gateway status instead of the storage node id", async () => {
    csrfFetchMock
      .mockResolvedValueOnce({ status: "running", proxy: { port: 31888, accessToken: "redacted", publicUrl: "http://203.0.113.10:31888" } })
      .mockResolvedValueOnce({ nodeId: "node_1", nodeName: "香港媒体库", remotePath: "/", entries: [] });

    render(
      <SftpBrowser
        sftpNodes={[{ id: "node_1", name: "香港媒体库", driver: "SFTP", serverId: "srv_1", serverName: "香港一号" }]}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText("节点"), "node_1");

    await waitFor(() => {
      expect(csrfFetchMock).toHaveBeenCalledWith("/api/servers/srv_1/file-proxy");
    });
    expect(csrfFetchMock).not.toHaveBeenCalledWith("/api/servers/node_1/file-proxy");
  });

  it("only switches the Direct Gateway toggle on after the start request succeeds", async () => {
    const user = userEvent.setup();
    csrfFetchMock
      .mockResolvedValueOnce({ status: "stopped" })
      .mockResolvedValueOnce({ nodeId: "node_1", nodeName: "香港媒体库", remotePath: "/", entries: [] })
      .mockRejectedValueOnce(new Error("SSH 连接失败"));

    render(
      <SftpBrowser
        sftpNodes={[{ id: "node_1", name: "香港媒体库", driver: "SFTP", serverId: "srv_1", serverName: "香港一号" }]}
      />,
    );

    await user.selectOptions(screen.getByLabelText("节点"), "node_1");
    await screen.findByText(/节点：香港媒体库/);
    await user.click(screen.getByRole("button", { name: "直连模式" }));

    expect(await screen.findByText(/SSH 连接失败/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "直连模式" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "直连模式 ON" })).not.toBeInTheDocument();
  });

  it("passes current remote path and recursive options when syncing SFTP entries", async () => {
    const user = userEvent.setup();
    csrfFetchMock
      .mockResolvedValueOnce({
        nodeId: "node_1",
        nodeName: "香港媒体库",
        remotePath: "/",
        entries: [
          { name: "logs", longname: "drwxr-xr-x logs", type: "directory", size: 0, modifyTime: 1_700_000_000_000, accessTime: 1_700_000_000_000 },
        ],
      })
      .mockResolvedValueOnce({
        nodeId: "node_1",
        nodeName: "香港媒体库",
        remotePath: "/logs",
        entries: [],
      })
      .mockResolvedValueOnce({ synced: 2, created: 1, updated: 1, errors: [] });

    render(<SftpBrowser sftpNodes={[{ id: "node_1", name: "香港媒体库", driver: "SFTP" }]} />);

    await user.selectOptions(screen.getByLabelText("节点"), "node_1");
    const logButtons = await screen.findAllByRole("button", { name: /logs/ });
    expect(logButtons.length).toBeGreaterThan(0);
    await user.click(logButtons[0]);
    await screen.findByText(/远端路径：\/logs/);
    await user.click(screen.getByLabelText("递归子目录"));
    await user.click(screen.getByRole("button", { name: "扫描同步" }));

    await waitFor(() => {
      expect(csrfFetchMock).toHaveBeenLastCalledWith("/api/storage/sftp-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: "node_1", remotePath: "/logs", recursive: true, maxDepth: 5 }),
      });
    });
  });
});
