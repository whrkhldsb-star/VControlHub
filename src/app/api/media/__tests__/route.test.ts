import { describe, expect, it, vi } from "vitest";

const {
  requireApiPermissionMock,
  listMediaItemsMock,
  scanMediaFromFileEntriesMock,
} = vi.hoisted(() => ({
  requireApiPermissionMock: vi.fn(),
  listMediaItemsMock: vi.fn(),
  scanMediaFromFileEntriesMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));

vi.mock("@/lib/media/service", () => ({
  listMediaItems: listMediaItemsMock,
  scanMediaFromFileEntries: scanMediaFromFileEntriesMock,
}));

import { GET, POST } from "../route";

const session = { userId: "u_1", username: "alice" };

describe("/api/media", () => {
  it("lists filtered media with storage read permission", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({ session });
    listMediaItemsMock.mockResolvedValueOnce([
      { id: "m_1", mediaType: "image" },
    ]);

    const response = await GET(
      new Request("https://example.com/api/media?type=image&q=cat"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireApiPermissionMock).toHaveBeenCalledWith("storage:read");
    expect(listMediaItemsMock).toHaveBeenCalledWith({
      mediaType: "image",
      q: "cat",
      favorite: undefined,
    });
    expect(body.media).toEqual([{ id: "m_1", mediaType: "image" }]);
  });

  it("scans media with media manage permission and authenticated user id", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({ session });
    scanMediaFromFileEntriesMock.mockResolvedValueOnce({ scanned: 2 });

    const response = await POST(
      new Request("https://example.com/api/media", { method: "POST" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireApiPermissionMock).toHaveBeenCalledWith("media:manage");
    expect(scanMediaFromFileEntriesMock).toHaveBeenCalledWith("u_1");
    expect(body).toEqual({ scanned: 2 });
  });
});
