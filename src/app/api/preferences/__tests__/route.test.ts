import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: vi.fn(async (_request, _options, handler) => handler({ session: { userId: "u_1" } })),
}));

import { GET, PUT } from "../route";

describe("/api/preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({ preferences: null });
    prismaMock.user.update.mockResolvedValue({});
  });

  it("normalizes stored preferences and does not return legacy no-op fields", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      preferences: {
        defaultPage: "https://evil.example",
        dashboardWidgets: ["analytics", "unknown", "analytics", "audit-log"],
        compactMode: true,
        sidebarCollapsed: true,
        autoRefreshInterval: 1,
      },
    });

    const response = await GET(new Request("http://local/api/preferences"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      defaultPage: "/",
      dashboardWidgets: ["analytics", "audit-log"],
      autoRefreshInterval: 5,
    }));
    expect(body).not.toHaveProperty("compactMode");
    expect(body).not.toHaveProperty("sidebarCollapsed");
  });

  it("persists only normalized preferences on update and returns the effective values", async () => {
    const response = await PUT(new Request("http://local/api/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        defaultPage: "/files",
        dashboardWidgets: ["quick-links", "unknown", "quick-links"],
        notificationsEnabled: false,
        notificationSound: false,
        autoRefreshInterval: 999,
        compactMode: true,
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      defaultPage: "/files",
      dashboardWidgets: ["quick-links"],
      notificationsEnabled: false,
      notificationSound: false,
      autoRefreshInterval: 300,
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u_1" },
      data: { preferences: body },
    });
  });
});
