import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { TextPreviewClient } from "../text-preview-client";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

describe("TextPreviewClient editable mode", () => {
  beforeEach(() => {
    vi.mocked(csrfFetch).mockReset();
  });

  it("requires diff review confirmation before saving edited file content", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({
        draft: {
          content: "alpha\nbeta\n",
          byteSize: 11,
          updatedAt: "2026-06-08T01:02:03.000Z",
          lastModifiedMs: 1780880523000,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        file: {
          byteSize: 17,
          previousByteSize: 11,
          updatedAt: "2026-06-08T01:03:03.000Z",
          lastModifiedMs: 1780880583000,
        },
      });

    render(<TextPreviewClient href="/download/readme.txt" name="readme.txt" fileEntryId="file_1" editable />);

    expect(await screen.findByText("可在线编辑 · 保存会校验并发修改")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "编辑" }));
    const editor = screen.getByRole("textbox", { name: "在线编辑文件内容" });
    fireEvent.change(editor, { target: { value: "alpha\ngamma\ndelta\n" } });

    await actor.click(screen.getByRole("button", { name: "预览并保存" }));

    const dialog = screen.getByRole("dialog", { name: "保存前差异预览" });
    expect(dialog).toHaveTextContent("新增 1 行，删除 0 行，修改 2 行");
    expect(dialog).toHaveTextContent("L2 · 修改");
    expect(dialog).toHaveTextContent("- beta");
    expect(dialog).toHaveTextContent("+ gamma");
    expect(csrfFetch).toHaveBeenCalledTimes(1);

    await actor.click(screen.getByRole("button", { name: "确认保存" }));

    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/files/editable/file_1", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({
        content: "alpha\ngamma\ndelta\n",
        expectedUpdatedAt: "2026-06-08T01:02:03.000Z",
        expectedLastModifiedMs: 1780880523000,
      }),
    })));
    expect(await screen.findByRole("status")).toHaveTextContent("已保存 17 B");
    expect(screen.queryByRole("dialog", { name: "保存前差异预览" })).not.toBeInTheDocument();
  });

  it("surfaces stale draft conflicts without closing the editor", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({
        draft: {
          content: "alpha\nbeta\n",
          byteSize: 11,
          updatedAt: "2026-06-08T01:02:03.000Z",
          lastModifiedMs: 1780880523000,
        },
      })
      .mockRejectedValueOnce(new Error("文件内容已在磁盘上发生变化，请重新加载后再保存"));

    render(<TextPreviewClient href="/download/readme.txt" name="readme.txt" fileEntryId="file_1" editable />);

    await screen.findByText("可在线编辑 · 保存会校验并发修改");
    await actor.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "在线编辑文件内容" }), { target: { value: "alpha\nchanged\n" } });
    await actor.click(screen.getByRole("button", { name: "预览并保存" }));
    expect(screen.getByRole("dialog", { name: "保存前差异预览" })).toHaveTextContent("保存时会校验打开草稿后的文件时间戳");

    await actor.click(screen.getByRole("button", { name: "确认保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("文件内容已在磁盘上发生变化，请重新加载后再保存");
    expect(screen.getByRole("textbox", { name: "在线编辑文件内容" })).toHaveValue("alpha\nchanged\n");
  });

  it("routes SFTP save through /api/storage/sftp-ops when driver is SFTP and exposes nodeId/relativePath", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({
        draft: {
          content: "alpha\nbeta\n",
          byteSize: 11,
          updatedAt: "2026-06-08T01:02:03.000Z",
          lastModifiedMs: 1780880523000,
        },
      })
      .mockResolvedValueOnce({ success: true, byteSize: 18 });

    render(
      <TextPreviewClient
        href="/api/storage/sftp-download?nodeId=node_1&path=etc/app.conf"
        name="app.conf"
        fileEntryId="file_sftp_1"
        editable
        driver="SFTP"
        nodeId="node_1"
        relativePath="etc/app.conf"
      />,
    );

    expect(await screen.findByText("可在线编辑 · 保存会校验并发修改")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "在线编辑文件内容" }), {
      target: { value: "alpha\ngamma\ndelta\n" },
    });
    await actor.click(screen.getByRole("button", { name: "预览并保存" }));
    expect(screen.getByRole("dialog", { name: "保存前差异预览" })).toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "确认保存" }));

    await waitFor(() =>
      expect(csrfFetch).toHaveBeenCalledWith(
        "/api/storage/sftp-ops",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            action: "write",
            nodeId: "node_1",
            path: "etc/app.conf",
            content: "alpha\ngamma\ndelta\n",
          }),
        }),
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("已保存 18 B");
  });

  it("surfaces SFTP save errors without closing the editor", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({
        draft: {
          content: "alpha\nbeta\n",
          byteSize: 11,
          updatedAt: "2026-06-08T01:02:03.000Z",
          lastModifiedMs: 1780880523000,
        },
      })
      .mockRejectedValueOnce(new Error("远端 SFTP 写入失败: 磁盘空间不足"));

    render(
      <TextPreviewClient
        href="/api/storage/sftp-download?nodeId=node_1&path=etc/app.conf"
        name="app.conf"
        fileEntryId="file_sftp_1"
        editable
        driver="SFTP"
        nodeId="node_1"
        relativePath="etc/app.conf"
      />,
    );

    await screen.findByText("可在线编辑 · 保存会校验并发修改");
    await actor.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "在线编辑文件内容" }), {
      target: { value: "alpha\nchanged\n" },
    });
    await actor.click(screen.getByRole("button", { name: "预览并保存" }));
    await actor.click(screen.getByRole("button", { name: "确认保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "远端 SFTP 写入失败: 磁盘空间不足",
    );
    expect(screen.getByRole("textbox", { name: "在线编辑文件内容" })).toHaveValue("alpha\nchanged\n");
  });

  it("shows visible labels for search and line jump controls", async () => {
    const actor = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "alpha\nbeta\ngamma\n",
    }));

    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(<TextPreviewClient href="/download/readme.txt" name="readme.txt" />);

    const searchLabel = await screen.findByText("搜索文本");
    const jumpLabel = screen.getByText("跳转行号");
    expect(searchLabel).toBeVisible();
    expect(jumpLabel).toBeVisible();

    const searchInput = screen.getByRole("textbox", { name: "搜索文本" });
    const jumpInput = screen.getByRole("textbox", { name: "跳转行号" });
    await actor.type(searchInput, "beta");
    await actor.type(jumpInput, "2");
    await actor.click(screen.getByRole("button", { name: "跳转" }));

    expect(searchInput).toHaveValue("beta");
    expect(jumpInput).toHaveValue("2");
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
  });

  it("exposes a '保存并重载 <unit>' button when SFTP driver + serverId + reloadUnit are supplied", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch).mockResolvedValueOnce({
      draft: {
        content: "user www-data;\n",
        byteSize: 15,
        updatedAt: "2026-06-15T01:00:00.000Z",
        lastModifiedMs: 1780999200000,
      },
    });

    render(
      <TextPreviewClient
        href="/api/storage/sftp-download?nodeId=node_1&path=etc/nginx/nginx.conf"
        name="nginx.conf"
        fileEntryId="file_nginx"
        editable
        driver="SFTP"
        nodeId="node_1"
        relativePath="etc/nginx/nginx.conf"
        serverId="srv_1"
        reloadUnit="nginx"
        reloadKind="systemd"
      />,
    );

    await screen.findByText("可在线编辑 · 保存会校验并发修改");
    await actor.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "在线编辑文件内容" }), {
      target: { value: "user www-data;\nworker_processes 4;\n" },
    });

    expect(
      screen.getByRole("button", { name: "保存并重载 nginx" }),
    ).toBeInTheDocument();
  });

  it("save + reload flow: writes draft then calls /api/servers/[serverId]/reload and surfaces success", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({
        draft: {
          content: "user www-data;\n",
          byteSize: 15,
          updatedAt: "2026-06-15T01:00:00.000Z",
          lastModifiedMs: 1780999200000,
        },
      })
      .mockResolvedValueOnce({ success: true, byteSize: 42 })
      .mockResolvedValueOnce({ success: true, exitCode: 0, stdout: "", stderr: "" });

    render(
      <TextPreviewClient
        href="/api/storage/sftp-download?nodeId=node_1&path=etc/nginx/nginx.conf"
        name="nginx.conf"
        fileEntryId="file_nginx"
        editable
        driver="SFTP"
        nodeId="node_1"
        relativePath="etc/nginx/nginx.conf"
        serverId="srv_1"
        reloadUnit="nginx"
        reloadKind="systemd"
      />,
    );

    await screen.findByText("可在线编辑 · 保存会校验并发修改");
    await actor.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "在线编辑文件内容" }), {
      target: { value: "user www-data;\nworker_processes 4;\n" },
    });
    await actor.click(screen.getByRole("button", { name: "保存并重载 nginx" }));

    await waitFor(() =>
      expect(csrfFetch).toHaveBeenCalledWith(
        "/api/servers/srv_1/reload",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ kind: "systemd", unit: "nginx" }),
        }),
      ),
    );
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("已保存 42 B · 服务已重载");
    expect(status).toHaveTextContent("重载成功，无需 SSH 重连");
  });

  it("save + reload flow: shows reload stderr without closing editor when systemctl exits non-zero", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({
        draft: {
          content: "user www-data;\n",
          byteSize: 15,
          updatedAt: "2026-06-15T01:00:00.000Z",
          lastModifiedMs: 1780999200000,
        },
      })
      .mockResolvedValueOnce({ success: true, byteSize: 42 })
      .mockResolvedValueOnce({
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "Job for nginx.service failed because the unit has a bad config",
      });

    render(
      <TextPreviewClient
        href="/api/storage/sftp-download?nodeId=node_1&path=etc/nginx/nginx.conf"
        name="nginx.conf"
        fileEntryId="file_nginx"
        editable
        driver="SFTP"
        nodeId="node_1"
        relativePath="etc/nginx/nginx.conf"
        serverId="srv_1"
        reloadUnit="nginx"
        reloadKind="systemd"
      />,
    );

    await screen.findByText("可在线编辑 · 保存会校验并发修改");
    await actor.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "在线编辑文件内容" }), {
      target: { value: "user www-data;\nbroken config\n" },
    });
    await actor.click(screen.getByRole("button", { name: "保存并重载 nginx" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("已保存 42 B · 服务重载失败");
    expect(alert).toHaveTextContent("exit=1");
    expect(alert).toHaveTextContent("bad config");
  });
});
