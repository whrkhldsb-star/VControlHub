import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ImageBedPageClient from "../image-bed-page-client";
import { csrfFetch } from "@/lib/auth/csrf-client";

vi.mock("next/image", () => ({
  default: ({
    alt: _alt,
    unoptimized: _unoptimized,
    fill: _fill,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean; fill?: boolean }) => (
    <picture data-testid="mock-next-image" {...props} />
  ),
}));

vi.mock("@/components/page-shell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
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
      if (url.startsWith("/api/images/list"))
        return { images: [], total: 0, totalPages: 1 };
      if (url === "/api/storage/nodes")
        return { nodes: [{ id: "node_1", name: "本机存储" }] };
      throw new Error(`unexpected request: ${url}`);
    });
  });

  it("loads local storage nodes through the supported API when opening cloud publish", async () => {
    const user = userEvent.setup();
    render(<ImageBedPageClient canWrite canDelete />);

    await screen.findByText("暂无图片，上传第一张吧 🎉");
    expect(screen.getByRole("heading", { name: "图片外链中心" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "图片搜索" })).toHaveAttribute("placeholder", "搜索文件名 / 路径 / 相册");
    expect(screen.getAllByRole("link", { name: /图片工作区/ })[0]).toHaveAttribute("href", "/media?type=image");
    await user.click(screen.getByRole("button", { name: "☁️ 从云盘发布" }));

    await waitFor(() =>
      expect(csrfFetch).toHaveBeenCalledWith("/api/storage/nodes"),
    );
    const options = await screen.findAllByRole("option", { name: "本机存储" });
    expect(options.some((option) => (option as HTMLOptionElement).value === "node_1")).toBe(
      true,
    );
  });

  it("surfaces storage node load failures instead of opening silently empty", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/images/list"))
        return { images: [], total: 0, totalPages: 1 };
      if (url === "/api/storage/nodes")
        throw new Error("缺少权限");
      throw new Error(`unexpected request: ${url}`);
    });

    render(<ImageBedPageClient canWrite canDelete />);

    await screen.findByText("暂无图片，上传第一张吧 🎉");
    await user.click(screen.getByRole("button", { name: "☁️ 从云盘发布" }));

    expect(await screen.findByText("缺少权限")).toBeInTheDocument();
  });

  it("shows image upload progress and per-file failures", async () => {
    vi.mocked(csrfFetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith("/api/images/list"))
        return { images: [], total: 0, totalPages: 1 };
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

    render(<ImageBedPageClient canWrite canDelete />);

    await screen.findByText("暂无图片，上传第一张吧 🎉");
    await userEvent.click(screen.getByRole("button", { name: /③ 兼容直传/ }));
    expect(screen.getByText("兼容直传入口")).toBeInTheDocument();
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [
          new File(["ok"], "ok.png", { type: "image/png" }),
          new File(["bad"], "bad.png", { type: "image/png" }),
        ],
      },
    });

    expect(
      await screen.findByRole("status", { name: "图片上传进度" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "图片上传进度" }),
      ).toHaveTextContent("已完成 1/2 张"),
    );
    expect(
      screen.getByRole("status", { name: "图片上传进度" }),
    ).toHaveTextContent("成功 1 · 失败 1");
    expect(screen.getByText(/ok\.png/)).toHaveTextContent("上传完成");
    expect(screen.getByText(/bad\.png/)).toHaveTextContent(
      "失败：图片解码失败",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "上传完成 1/2 张，1 张失败",
    );
  });

  it("uses an in-app confirmation before deleting a single image", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(csrfFetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith("/api/images/list")) {
        return {
          images: [
            {
              id: "img_1",
              filename: "cat.png",
              mimeType: "image/png",
              sizeBytes: 1024,
              album: null,
              isPublic: true,
              createdAt: "2026-01-01T00:00:00.000Z",
              publicUrl: "/api/images/img_1/file",
            },
          ],
          total: 1,
          totalPages: 1,
        };
      }
      if (url === "/api/images/img_1" && init?.method === "DELETE") return {};
      throw new Error(`unexpected request: ${url}`);
    });

    render(<ImageBedPageClient canWrite canDelete />);

    await screen.findByText("cat.png");
    await user.click(screen.getByTitle("删除"));

    const dialog = await screen.findByRole("dialog", { name: "确认删除图片" });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent("cat.png");
    expect(csrfFetch).not.toHaveBeenCalledWith(
      "/api/images/img_1",
      expect.anything(),
    );

    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(
      screen.queryByRole("dialog", { name: "确认删除图片" }),
    ).not.toBeInTheDocument();
    expect(csrfFetch).not.toHaveBeenCalledWith(
      "/api/images/img_1",
      expect.anything(),
    );

    await user.click(screen.getByTitle("删除"));
    await user.click(
      within(
        await screen.findByRole("dialog", { name: "确认删除图片" }),
      ).getByRole("button", { name: "确认删除" }),
    );

    await waitFor(() =>
      expect(csrfFetch).toHaveBeenCalledWith("/api/images/img_1", {
        method: "DELETE",
      }),
    );
  });

  it("uses an in-app confirmation before batch deleting selected images", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(csrfFetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith("/api/images/list")) {
        return {
          images: [
            {
              id: "img_1",
              filename: "cat.png",
              mimeType: "image/png",
              sizeBytes: 1024,
              album: null,
              isPublic: true,
              createdAt: "2026-01-01T00:00:00.000Z",
              publicUrl: "/api/images/img_1/file",
            },
            {
              id: "img_2",
              filename: "dog.png",
              mimeType: "image/png",
              sizeBytes: 2048,
              album: null,
              isPublic: true,
              createdAt: "2026-01-02T00:00:00.000Z",
              publicUrl: "/api/images/img_2/file",
            },
          ],
          total: 2,
          totalPages: 1,
        };
      }
      if (url === "/api/images/batch" && init?.method === "POST")
        return { deleted: 2 };
      throw new Error(`unexpected request: ${url}`);
    });

    render(<ImageBedPageClient canWrite canDelete />);

    await screen.findByText("cat.png");
    await user.click(screen.getByRole("button", { name: "☐ 批量模式" }));
    await user.click(screen.getByText("全选"));
    await user.click(screen.getByRole("button", { name: "🗑 批量删除" }));

    const dialog = await screen.findByRole("dialog", {
      name: "确认批量删除图片",
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent("2 张图片");

    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(csrfFetch).not.toHaveBeenCalledWith(
      "/api/images/batch",
      expect.anything(),
    );

    await user.click(screen.getByRole("button", { name: "🗑 批量删除" }));
    await user.click(
      within(
        await screen.findByRole("dialog", { name: "确认批量删除图片" }),
      ).getByRole("button", { name: "确认删除" }),
    );

    await waitFor(() =>
      expect(csrfFetch).toHaveBeenCalledWith(
        "/api/images/batch",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const batchCall = vi
      .mocked(csrfFetch)
      .mock.calls.find(([url]) => url === "/api/images/batch");
    expect(JSON.parse(String(batchCall?.[1]?.body))).toEqual({
      action: "delete",
      ids: ["img_1", "img_2"],
    });
  });

  it("opens the in-page preview with the streamed file URL for private images", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/images/list")) {
        return {
          images: [
            {
              id: "img_private",
              filename: "private-cat.png",
              mimeType: "image/png",
              sizeBytes: 4096,
              album: "pets",
              isPublic: false,
              createdAt: "2026-01-01T00:00:00.000Z",
              publicUrl: "/api/images/img_private/file",
              storageNodeId: "node_1",
              relativePath: "image-bed/2026/private-cat.png",
              storageNode: {
                id: "node_1",
                name: "本机图片库",
                driver: "LOCAL",
                server: { name: "主节点" },
              },
            },
          ],
          total: 1,
          totalPages: 1,
        };
      }
      throw new Error(`unexpected request: ${url}`);
    });

    render(<ImageBedPageClient canWrite canDelete />);

    await screen.findByText("private-cat.png");
    expect(screen.getByText("来源：本机图片库 · 主节点 / image-bed/2026/private-cat.png")).toBeInTheDocument();
    expect(screen.getByText("私有")).toBeInTheDocument();
    const images = screen.getAllByTestId("mock-next-image");
    expect(images[0]).toHaveAttribute("src", "/api/images/img_private/file");

    await user.click(images[0]);

    expect(await screen.findByText("4.0 KB · image/png")).toBeInTheDocument();
    expect(screen.getAllByTestId("mock-next-image")[1]).toHaveAttribute(
      "src",
      "/api/images/img_private/file",
    );
  });
});
