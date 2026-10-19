import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MediaItemCard, type MediaItem } from "../media-item-card";
import { csrfFetch } from "@/lib/auth/csrf-client";

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));

const item: MediaItem = {
  id: "m_1",
  name: "movie.mp4",
  relativePath: "movies/2026/movie.mp4",
  mediaType: "video",
  mimeType: "video/mp4",
  size: 2048,
  favorite: false,
  tags: ["demo"],
  storageNode: {
    id: "node_sftp",
    name: "远端存储",
    basePath: "/srv/media",
    driver: "SFTP",
    directAccessMode: "managed-download",
    publicBaseUrl: null,
    server: { name: "VPS-1" },
  },
};

describe("MediaItemCard", () => {
  it("renders a video cover from the media stream endpoint", () => {
    render(<MediaItemCard item={item} canManage />);

    const cover = screen.getByRole("link", { name: /movie\.mp4 视频预览/ });
    expect(cover).toHaveAttribute("href", "/media/m_1?from=%2Fmedia");
    // Video covers intentionally render the icon fallback instead of an
    // <img src=/api/media/:id/stream#t=…> poster — N concurrent stream opens
    // per grid page were a resource leak (thumbnail API is image-only).
    expect(cover.querySelector('img')).toBeNull();
    expect(screen.getByText(/视频预览/)).toBeInTheDocument();
  });

  it("renders image thumbnails and audio icon covers with one visual style", () => {
    render(
      <>
        <MediaItemCard item={{ ...item, id: "img_1", mediaType: "image", mimeType: "image/png", name: "photo.png", relativePath: "images/photo.png" }} canManage />
        <MediaItemCard item={{ ...item, id: "aud_1", mediaType: "audio", mimeType: "audio/mpeg", name: "song.mp3", relativePath: "audio/song.mp3" }} canManage />
      </>,
    );

    expect(screen.getByRole("img", { name: "photo.png 缩略图" })).toHaveAttribute("src", "/api/media/img_1/thumbnail");
    expect(screen.getByRole("link", { name: /song\.mp3 音频预览/ })).toHaveTextContent("音频预览");
  });

  it("opens media-owned player while keeping download and source-file actions", () => {
    render(<MediaItemCard item={item} canManage />);

    const preview = screen.getByRole("link", { name: /预览\/播放/ });
    expect(preview).toHaveAttribute("href", "/media/m_1?from=%2Fmedia");

    const download = screen.getByRole("link", { name: /下载/ });
    expect(download).toHaveAttribute(
      "href",
      "/api/storage/sftp-download?nodeId=node_sftp&path=movies%2F2026%2Fmovie.mp4&download=1",
    );

    const source = screen.getByRole("link", { name: /源文件/ });
    expect(source).toHaveAttribute(
      "href",
      "/files?path=movies%2F2026&nodeId=node_sftp&q=movie.mp4",
    );
  });

  it("returns to and navigates within the list it was opened from", () => {
    render(<MediaItemCard item={item} canManage listHref="/media?type=video&q=demo&page=3" />);
    expect(screen.getByRole("link", { name: /预览\/播放/ })).toHaveAttribute("href", "/media/m_1?from=%2Fmedia%3Ftype%3Dvideo%26q%3Ddemo%26page%3D3");
  });

  it("offers image-bed publishing only for stored images", () => {
    render(<MediaItemCard item={{ ...item, mediaType: "image", mimeType: "image/png", name: "photo.png", relativePath: "images/photo.png" }} canManage />);

    expect(screen.getByRole("button", { name: /图床外链/ })).toBeInTheDocument();
  });

  it("shows a visible error when favorite updates fail", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("保存收藏失败"));

    render(<MediaItemCard item={item} canManage />);

    await user.click(screen.getByRole("button", { name: "收藏" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("保存收藏失败");
  });

  it("sends one card's saves in click order and a stale failure does not undo a newer change", async () => {
    // Two PATCHes in flight could land in either order, and the older one's
    // failure rolled the tags back over the newer, saved change.
    const pending: Array<{ body: unknown; settle: (ok: boolean) => void }> = [];
    vi.mocked(csrfFetch).mockImplementation((_url: unknown, init?: RequestInit) => new Promise((resolve, reject) => {
      pending.push({ body: JSON.parse(String(init?.body)), settle: (ok) => (ok ? resolve({} as never) : reject(new Error("HTTP 500"))) });
    }) as never);
    render(<MediaItemCard item={{ ...item, tags: ["alpha"] }} canManage />);

    await userEvent.click(screen.getByRole("button", { name: "删除" }));
    await userEvent.click(screen.getByText("添加标签"));
    await userEvent.type(screen.getByRole("textbox"), "beta{Enter}");
    // The second save waits for the first.
    expect(pending.map((call) => call.body)).toEqual([{ tags: [] }]);

    await act(async () => pending[0]!.settle(false));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1]!.body).toEqual({ tags: ["beta"] });
    await act(async () => pending[1]!.settle(true));

    expect(screen.getByText("#beta")).toBeInTheDocument();
    expect(screen.queryByText("#alpha")).not.toBeInTheDocument();
  });
});

