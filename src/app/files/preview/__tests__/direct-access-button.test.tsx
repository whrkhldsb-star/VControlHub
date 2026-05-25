import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DirectAccessButton } from "../direct-access-button";

describe("DirectAccessButton", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the managed SFTP fallback when direct access returns proxy mode", async () => {
    const onUrlReady = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        error: "VPS 直连播放已停用，请使用受控的 SFTP 中转预览/下载。",
        fallbackUrl: "/api/storage/sftp-download?nodeId=node_1&path=movies%2Fdemo.mp4",
        mode: "managed-download",
      }),
    } as Response);

    render(
      <DirectAccessButton
        nodeId="node_1"
        relativePath="movies/demo.mp4"
        driver="SFTP"
        fileName="demo.mp4"
        onUrlReady={onUrlReady}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "直连目标服务器播放 demo.mp4" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/storage/direct-access",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => {
      expect(onUrlReady).toHaveBeenCalledWith(
        "/api/storage/sftp-download?nodeId=node_1&path=movies%2Fdemo.mp4",
      );
    });
    expect(screen.getByText(/网站服务器中转播放/)).toBeInTheDocument();
    expect(screen.queryByText("VPS 直连播放已停用，请使用受控的 SFTP 中转预览/下载。")).not.toBeInTheDocument();
  });

  it("shows explicit website-proxy and target-server playback choices", async () => {
    const onUrlReady = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        fallbackUrl: "/api/storage/sftp-download?nodeId=node_1&path=movies%2Fdemo.mp4",
        mode: "direct-url",
        url: "https://media.example.com/movies/demo.mp4?sig=abc",
      }),
    } as Response);

    render(
      <DirectAccessButton
        nodeId="node_1"
        relativePath="movies/demo.mp4"
        driver="SFTP"
        fileName="demo.mp4"
        onUrlReady={onUrlReady}
      />,
    );

    expect(screen.getByText(/播放流量/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "直连目标服务器播放 demo.mp4" }));

    await waitFor(() => {
      expect(onUrlReady).toHaveBeenCalledWith("https://media.example.com/movies/demo.mp4?sig=abc");
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/storage/direct-access",
      expect.objectContaining({
        body: JSON.stringify({ nodeId: "node_1", relativePath: "movies/demo.mp4" }),
      }),
    );
    expect(screen.getByText("✅ 当前：目标服务器直连播放")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "经网站服务器播放 demo.mp4" }));

    await waitFor(() => {
      expect(onUrlReady).toHaveBeenCalledWith(
        "/api/storage/sftp-download?nodeId=node_1&path=movies%2Fdemo.mp4",
      );
    });
    expect(screen.getByText("✅ 当前：网站服务器中转播放")).toBeInTheDocument();
  });

  it("does not render for non-SFTP storage drivers", () => {
    render(
      <DirectAccessButton
        nodeId="node_1"
        relativePath="docs/readme.txt"
        driver="LOCAL"
        fileName="readme.txt"
        onUrlReady={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "直连目标服务器播放 readme.txt" })).not.toBeInTheDocument();
  });
});
