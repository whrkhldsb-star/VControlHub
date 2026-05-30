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
vi.mock("@/lib/system-health/service", () => ({
  collectSystemHealthChecks: vi.fn().mockResolvedValue({
    generatedAt: "2026-05-30T00:00:00.000Z",
    summary: { total: 4, healthy: 3, warning: 1, critical: 0, overall: "warning" },
    checks: [{ id: "next-service" }, { id: "ssh-ws-service" }, { id: "database" }, { id: "git-sync" }],
  }),
}));
vi.mock("../health-dashboard-client", () => ({
  HealthDashboardClient: ({ serverCount, initialSystemHealth }: { serverCount: number; initialSystemHealth?: { summary: { total: number; healthy: number; warning: number; critical: number; overall: string }; checks?: Array<{ id: string }> } | null }) => (
    <div data-testid="health-dashboard">
      节点数量：{serverCount}
      <span data-testid="system-health-overall">{initialSystemHealth?.summary.overall ?? "none"}</span>
      <span data-testid="system-health-check-count">{initialSystemHealth?.checks?.length ?? 0}</span>
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
    expect(screen.getByTestId("system-health-overall")).toHaveTextContent("warning");
    expect(screen.getByTestId("system-health-check-count")).toHaveTextContent("4");
  });
});
