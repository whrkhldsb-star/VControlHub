import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSessionMock, sessionHasPermissionMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-session", () => ({ requireSession: requireSessionMock }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: sessionHasPermissionMock }));
vi.mock("../system-health-client", () => ({
  SystemHealthClient: ({
    initialSystemHealth,
  }: {
    initialSystemHealth?: { summary: { total: number } } | null;
  }) => (
    <div data-testid="system-health">
      <span data-testid="initial-system-health">
        {initialSystemHealth === null ? "null" : initialSystemHealth ? "report" : "missing"}
      </span>
    </div>
  ),
}));

import HealthPage from "../page";

describe("HealthPage (system half)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue({ userId: "user_1", username: "viewer", roles: ["viewer"] });
    sessionHasPermissionMock.mockReturnValue(true);
  });

  it("shows a permission notice without health read permission", async () => {
    sessionHasPermissionMock.mockReturnValueOnce(false);

    render(await HealthPage());

    expect(requireSessionMock).toHaveBeenCalledWith("/health");
    expect(sessionHasPermissionMock).toHaveBeenCalledWith(
      { userId: "user_1", username: "viewer", roles: ["viewer"] },
      "health:read",
    );
    expect(screen.getByText("缺少健康监控权限")).toBeInTheDocument();
    expect(screen.queryByTestId("system-health")).not.toBeInTheDocument();
  });

  it("renders the system health client for users with health:read", async () => {
    render(await HealthPage());

    expect(screen.getByTestId("system-health")).toBeInTheDocument();
    expect(screen.getByTestId("initial-system-health")).toHaveTextContent("null");
  });
});
