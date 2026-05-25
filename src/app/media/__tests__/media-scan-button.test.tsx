import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { MediaScanButton } from "../media-scan-button";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

const refreshMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

describe("MediaScanButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the media scan API and reports scanned/upserted counts", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockResolvedValueOnce({ scanned: 4, upserted: 3 });

    render(<MediaScanButton />);

    await user.click(screen.getByRole("button", { name: "扫描媒体索引" }));

    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/media", { method: "POST" }));
    expect(await screen.findByRole("status")).toHaveTextContent("扫描完成：发现 4 个媒体文件，更新 3 条索引");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces media scan failures and re-enables the button", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("存储索引读取失败"));

    render(<MediaScanButton />);

    await user.click(screen.getByRole("button", { name: "扫描媒体索引" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("存储索引读取失败");
    expect(screen.getByRole("button", { name: "扫描媒体索引" })).toBeEnabled();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
