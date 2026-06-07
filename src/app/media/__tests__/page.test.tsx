import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-session", () => ({
  requireSession: vi.fn().mockResolvedValue({
    userId: "u1",
    username: "admin",
    roles: ["admin"],
    permissions: ["storage:read", "media:manage"],
    mustChangePassword: false,
  }),
}));

vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: vi.fn((_session, permission: string) => ["storage:read", "media:manage"].includes(permission)),
}));

const listMediaItemsMock = vi.fn();
const listMediaTagsMock = vi.fn();
const listMediaTypeCountsMock = vi.fn();

vi.mock("@/lib/media/service", () => ({
  listMediaItems: (...args: unknown[]) => listMediaItemsMock(...args),
  listMediaTags: (...args: unknown[]) => listMediaTagsMock(...args),
  listMediaTypeCounts: (...args: unknown[]) => listMediaTypeCountsMock(...args),
}));

vi.mock("../media-image-upload-panel", () => ({
  MediaImageUploadPanel: () => <div>图片批量上传面板</div>,
}));

vi.mock("../media-scan-button", () => ({
  MediaScanButton: () => <button type="button">扫描媒体索引</button>,
}));

vi.mock("../media-item-card", () => ({
  MediaItemCard: ({ item }: { item: { name: string } }) => <article>{item.name}</article>,
}));

import MediaPage from "../page";

const mediaItem = {
  id: "media-1",
  name: "movie.mp4",
  mediaType: "video",
  relativePath: "movies/movie.mp4",
  size: BigInt(1024),
  favorite: false,
  tags: ["demo"],
  mimeType: "video/mp4",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  storageNode: { id: "node-1", name: "媒体节点", basePath: "/srv/media", driver: "LOCAL", directAccessMode: "PROXY", publicBaseUrl: null, serverId: null, server: null },
};

describe("MediaPage", () => {
  beforeEach(() => {
    listMediaItemsMock.mockReset();
    listMediaTagsMock.mockReset();
    listMediaTypeCountsMock.mockReset();
    listMediaItemsMock.mockResolvedValue([mediaItem]);
    listMediaTagsMock.mockResolvedValue([{ tag: "demo", count: 1 }]);
    listMediaTypeCountsMock.mockResolvedValue({ image: 12, video: 3, audio: 2 });
  });

  it("renders a first-class media type switcher with global counts", async () => {
    render(await MediaPage({ searchParams: Promise.resolve({ type: "video", q: "demo" }) }));

    expect(screen.getByRole("heading", { name: "媒体库" })).toBeInTheDocument();
    expect(screen.getByText("媒体类型切换")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /全部 17/ })).toHaveAttribute("href", "/media?q=demo");
    expect(screen.getByRole("link", { name: /🖼️ 图片\s*12/ })).toHaveAttribute("href", "/media?type=image&q=demo");
    expect(screen.getByRole("link", { name: /🎬 视频\s*3\s*×/ })).toHaveAttribute("href", "/media?q=demo");
    expect(screen.getByRole("link", { name: /🎧 音频\s*2/ })).toHaveAttribute("href", "/media?type=audio&q=demo");
    expect(screen.getByText("当前视图 1 项")).toBeInTheDocument();
    expect(listMediaItemsMock).toHaveBeenCalledWith({ mediaType: "video", q: "demo", favorite: undefined, tag: undefined });
    expect(listMediaTypeCountsMock).toHaveBeenCalledWith({ q: "demo", favorite: undefined, tag: undefined });
  });

  it("shows the image workspace upload panel only in image mode", async () => {
    render(await MediaPage({ searchParams: Promise.resolve({ type: "image" }) }));

    expect(screen.getByText("图片批量上传面板")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "外链管理 / 来源审计" })).toHaveAttribute("href", "/image-bed");
  });
});
