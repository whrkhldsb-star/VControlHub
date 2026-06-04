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
});
