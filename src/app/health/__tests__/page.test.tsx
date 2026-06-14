import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSessionMock, sessionHasPermissionMock, listServerProfilesMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  listServerProfilesMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-session", () => ({ requireSession: requireSessionMock }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: sessionHasPermissionMock }));
vi.mock("@/lib/server/service", () => ({ listServerProfiles: listServerProfilesMock }));
vi.mock("../health-dashboard-client", () => ({
  HealthDashboardClient: ({ serverCount, initialSystemHealth }: { serverCount: number; initialSystemHealth?: { summary: { total: number; healthy: number; warning: number; critical: number; overall: string }; checks?: Array<{ id: string }> } | null }) => (
    <div data-testid="health-dashboard">
      节点数量：{serverCount}
      <span data-testid="initial-system-health">{initialSystemHealth === null ? "null" : initialSystemHealth ? "report" : "missing"}</span>
    </div>
  ),
}));

import HealthPage from "../page";

describe("HealthPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue({ userId: "user_1", username: "viewer", roles: ["viewer"] });
    sessionHasPermissionMock.mockReturnValue(true);
    listServerProfilesMock.mockResolvedValue([{ id: "srv_1", name: "生产节点", host: "10.0.0.5", enabled: true }]);
  });

  it("shows a permission notice instead of loading server details without health read permission", async () => {
    sessionHasPermissionMock.mockReturnValueOnce(false);

    render(await HealthPage());

    expect(requireSessionMock).toHaveBeenCalledWith("/health");
    expect(sessionHasPermissionMock).toHaveBeenCalledWith(
      { userId: "user_1", username: "viewer", roles: ["viewer"] },
      "health:read",
    );
    expect(listServerProfilesMock).not.toHaveBeenCalled();
    expect(screen.getByText("缺少健康监控权限")).toBeInTheDocument();
    expect(screen.queryByTestId("health-dashboard")).not.toBeInTheDocument();
  });

  it("renders the health dashboard for users with health read permission", async () => {
    render(await HealthPage());

    expect(listServerProfilesMock).toHaveBeenCalledOnce();
    expect(screen.getByTestId("health-dashboard")).toHaveTextContent("节点数量：1");
    // Initial system health is now intentionally null on the server side; the
    // dashboard fetches /api/system-health on mount so the page can render
    // immediately without waiting for an SSH/disk probe round-trip.
    expect(screen.getByTestId("initial-system-health")).toHaveTextContent("null");
  });
});

