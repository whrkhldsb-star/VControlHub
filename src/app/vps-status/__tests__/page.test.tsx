import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireSessionMock,
  sessionHasPermissionMock,
  listServerProfilesMock,
} = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  listServerProfilesMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-session", () => ({ requireSession: requireSessionMock }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: sessionHasPermissionMock }));
vi.mock("@/lib/server/service", () => ({ listServerProfiles: listServerProfilesMock }));
vi.mock("../vps-status-client", () => ({
  VpsStatusClient: ({ serverCount }: { serverCount: number }) => (
    <div data-testid="vps-status">节点数量：{serverCount}</div>
  ),
}));

import VpsStatusPage from "../page";

describe("VpsStatusPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue({ userId: "user_1", username: "viewer", roles: ["viewer"] });
    sessionHasPermissionMock.mockReturnValue(true);
    listServerProfilesMock.mockResolvedValue([
      { id: "srv_1", name: "生产节点", host: "10.0.0.5", enabled: true },
    ]);
  });

  it("shows permission notice without health:read", async () => {
    sessionHasPermissionMock.mockReturnValueOnce(false);
    render(await VpsStatusPage());
    expect(requireSessionMock).toHaveBeenCalledWith("/vps-status");
    expect(listServerProfilesMock).not.toHaveBeenCalled();
    expect(screen.getByText("缺少健康监控权限")).toBeInTheDocument();
  });

  it("renders VPS status client with server count", async () => {
    render(await VpsStatusPage());
    expect(listServerProfilesMock).toHaveBeenCalledOnce();
    expect(screen.getByTestId("vps-status")).toHaveTextContent("节点数量：1");
  });
});
