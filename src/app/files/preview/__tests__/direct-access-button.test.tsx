import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DirectAccessButton } from "../direct-access-button";

describe("DirectAccessButton", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the managed SFTP fallback when direct public serving is disabled", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "使用受控中转播放" }));

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
    expect(screen.getByText("✅ 已切换到受控 SFTP 中转播放")).toBeInTheDocument();
    expect(screen.queryByText("VPS 直连播放已停用，请使用受控的 SFTP 中转预览/下载。")).not.toBeInTheDocument();
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

    expect(screen.queryByRole("button", { name: "使用受控中转播放" })).not.toBeInTheDocument();
  });
});
