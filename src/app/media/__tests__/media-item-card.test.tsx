import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MediaItemCard, type MediaItem } from "../media-item-card";

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
    expect(screen.getByLabelText("movie.mp4 视频封面")).toHaveAttribute("src", "/api/media/m_1/stream#t=0.1");
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

  it("offers image-bed publishing only for stored images", () => {
    render(<MediaItemCard item={{ ...item, mediaType: "image", mimeType: "image/png", name: "photo.png", relativePath: "images/photo.png" }} canManage />);

    expect(screen.getByRole("button", { name: /图床外链/ })).toBeInTheDocument();
  });
});
