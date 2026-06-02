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

  it("renders an actionable empty state when no SFTP nodes exist", () => {
    render(<SftpBrowser sftpNodes={[]} />);

    expect(screen.getByText("还没有可浏览的 SFTP 存储节点")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "添加 VPS 并创建 SFTP" })).toHaveAttribute("href", "/servers");
    expect(screen.getByRole("link", { name: "管理存储节点" })).toHaveAttribute("href", "#storage-nodes");
    expect(csrfFetchMock).not.toHaveBeenCalled();
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

  it("builds usable Direct Gateway download links without duplicating the proxy port", async () => {
    const user = userEvent.setup();
    csrfFetchMock
      .mockResolvedValueOnce({ status: "stopped" })
      .mockResolvedValueOnce({
        nodeId: "node_1",
        nodeName: "香港媒体库",
        remotePath: "/",
        entries: [
          { name: "demo file.mp4", longname: "-rw-r--r-- demo file.mp4", type: "file", size: 128, modifyTime: 1_700_000_000_000, accessTime: 1_700_000_000_000 },
        ],
      })
      .mockResolvedValueOnce({ status: "running", proxy: { port: 31888, accessToken: "token value", publicUrl: "http://203.0.113.10:31888" } });

    render(
      <SftpBrowser
        sftpNodes={[{ id: "node_1", name: "香港媒体库", driver: "SFTP", serverId: "srv_1", serverName: "香港一号" }]}
      />,
    );

    await user.selectOptions(screen.getByLabelText("节点"), "node_1");
    await waitFor(() => {
      expect(screen.getAllByText(/demo file\.mp4/).length).toBeGreaterThan(0);
    });
    await user.click(screen.getByRole("button", { name: "直连模式" }));
    await screen.findByRole("button", { name: "直连模式 ON" });

    const downloadLinks = screen.getAllByRole("link", { name: "下载" });
    expect(downloadLinks[0]).toHaveAttribute(
      "href",
      "http://203.0.113.10:31888/demo%20file.mp4?token=token+value",
    );
    expect(downloadLinks[0].getAttribute("href")).not.toContain(":31888:31888");
  });

  it("notifies the unified file list when the SFTP directory changes", async () => {
    const user = userEvent.setup();
    const onDirectoryChange = vi.fn();
    csrfFetchMock
      .mockResolvedValueOnce({
        nodeId: "node_1",
        nodeName: "香港媒体库",
        remotePath: "/",
        entries: [
          { name: "logs", longname: "drwxr-xr-x logs", type: "directory", size: 0, modifyTime: 1_700_000_000_000, accessTime: 1_700_000_000_000 },
        ],
      })
      .mockResolvedValueOnce({ nodeId: "node_1", nodeName: "香港媒体库", remotePath: "/logs", entries: [] });

    render(<SftpBrowser sftpNodes={[{ id: "node_1", name: "香港媒体库", driver: "SFTP" }]} onDirectoryChange={onDirectoryChange} />);

    await user.selectOptions(screen.getByLabelText("节点"), "node_1");
    await waitFor(() => expect(onDirectoryChange).toHaveBeenCalledWith({ nodeId: "node_1", remotePath: "/" }));
    await user.click((await screen.findAllByRole("button", { name: /logs/ }))[0]);

    await waitFor(() => expect(onDirectoryChange).toHaveBeenLastCalledWith({ nodeId: "node_1", remotePath: "/logs" }));
  });

  it("renders real preview links for previewable remote SFTP files", async () => {
    const user = userEvent.setup();
    csrfFetchMock.mockResolvedValueOnce({
      nodeId: "node_1",
      nodeName: "香港媒体库",
      remotePath: "/媒体",
      entries: [
        { name: "demo file.mp4", longname: "-rw-r--r-- demo file.mp4", type: "file", size: 128, modifyTime: 1_700_000_000_000, accessTime: 1_700_000_000_000 },
      ],
    });

    render(<SftpBrowser sftpNodes={[{ id: "node_1", name: "香港媒体库", driver: "SFTP" }]} />);

    await user.selectOptions(screen.getByLabelText("节点"), "node_1");

    const previewLinks = await screen.findAllByRole("link", { name: "预览" });
    expect(previewLinks[0]).toHaveAttribute(
      "href",
      "/files/preview?href=%2Fapi%2Fstorage%2Fsftp-download%3FnodeId%3Dnode_1%26path%3D%252F%25E5%25AA%2592%25E4%25BD%2593%252Fdemo%2Bfile.mp4&name=demo+file.mp4&type=video%2Fmp4&driver=SFTP&nodeId=node_1&relativePath=%2F%E5%AA%92%E4%BD%93%2Fdemo+file.mp4",
    );
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
      .mockResolvedValueOnce({ success: true, synced: 2, created: 1, updated: 1, deleted: 0, errors: [] });

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

  it("shows SFTP sync errors as incomplete work instead of a successful-looking completion", async () => {
    const user = userEvent.setup();
    csrfFetchMock
      .mockResolvedValueOnce({
        nodeId: "node_1",
        nodeName: "香港媒体库",
        remotePath: "/",
        entries: [],
      })
      .mockResolvedValueOnce({
        success: false,
        synced: 0,
        created: 0,
        updated: 0,
        deleted: 0,
        errors: ["扫描 /data/files 失败：扫描 /data/files 超过 60 秒，已停止本目录同步"],
      });

    render(<SftpBrowser sftpNodes={[{ id: "node_1", name: "香港媒体库", driver: "SFTP" }]} />);

    await user.selectOptions(screen.getByLabelText("节点"), "node_1");
    await screen.findByText(/节点：香港媒体库/);
    await user.click(screen.getByRole("button", { name: "扫描同步" }));

    expect(await screen.findByText(/同步未完全完成/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("超过 60 秒");
    expect(screen.queryByText(/✅ 同步完成/)).not.toBeInTheDocument();
  });
});
