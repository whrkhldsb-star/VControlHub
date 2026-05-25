import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ImageBedPage from "../page";
import { csrfFetch } from "@/lib/auth/csrf-client";

vi.mock("next/image", () => ({
  default: ({ alt: _alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => <picture data-testid="mock-next-image" {...props} />,
}));

vi.mock("@/components/page-shell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

describe("ImageBedPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.mocked(csrfFetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/images/list")) return { images: [], total: 0, totalPages: 1 };
      if (url === "/api/storage/nodes?driver=LOCAL") return { nodes: [{ id: "node_1", name: "本机存储" }] };
      throw new Error(`unexpected request: ${url}`);
    });
  });

  it("loads local storage nodes through the supported API when opening cloud publish", async () => {
    const user = userEvent.setup();
    render(<ImageBedPage />);

    await screen.findByText("暂无图片，上传第一张吧 🎉");
    await user.click(screen.getByRole("button", { name: "☁️ 云盘发布" }));

    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/storage/nodes?driver=LOCAL"));
    expect(await screen.findByRole("option", { name: "本机存储" })).toHaveValue("node_1");
  });

  it("surfaces storage node load failures instead of opening silently empty", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/images/list")) return { images: [], total: 0, totalPages: 1 };
      if (url === "/api/storage/nodes?driver=LOCAL") throw new Error("缺少权限");
      throw new Error(`unexpected request: ${url}`);
    });

    render(<ImageBedPage />);

    await screen.findByText("暂无图片，上传第一张吧 🎉");
    await user.click(screen.getByRole("button", { name: "☁️ 云盘发布" }));

    expect(await screen.findByText("缺少权限")).toBeInTheDocument();
  });
});
