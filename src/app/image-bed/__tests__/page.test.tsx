import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("shows image upload progress and per-file failures", async () => {
    vi.mocked(csrfFetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith("/api/images/list")) return { images: [], total: 0, totalPages: 1 };
      if (url === "/api/images/upload") {
        const formData = init?.body as FormData;
        const file = formData.get("file") as File;
        if (file.name === "ok.png") {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        if (file.name === "bad.png") throw new Error("图片解码失败");
        return { id: `img_${file.name}` };
      }
      throw new Error(`unexpected request: ${url}`);
    });

    render(<ImageBedPage />);

    await screen.findByText("暂无图片，上传第一张吧 🎉");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [
          new File(["ok"], "ok.png", { type: "image/png" }),
          new File(["bad"], "bad.png", { type: "image/png" }),
        ],
      },
    });

    expect(await screen.findByRole("status", { name: "图片上传进度" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status", { name: "图片上传进度" })).toHaveTextContent("已完成 1/2 张"));
    expect(screen.getByRole("status", { name: "图片上传进度" })).toHaveTextContent("成功 1 · 失败 1");
    expect(screen.getByText(/ok\.png/)).toHaveTextContent("上传完成");
    expect(screen.getByText(/bad\.png/)).toHaveTextContent("失败：图片解码失败");
    expect(screen.getByRole("alert")).toHaveTextContent("上传完成 1/2 张，1 张失败");
  });
});
