import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireSessionMock,
  sessionHasPermissionMock,
  countServerProfilesMock,
} = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  countServerProfilesMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-session", () => ({ requireSession: requireSessionMock }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: sessionHasPermissionMock }));
vi.mock("@/lib/server/service", () => ({ countServerProfiles: countServerProfilesMock }));
vi.mock("../vps-status-client", () => ({
  VpsStatusClient: ({ serverCount }: { serverCount: number }) => (
    <div data-testid="vps-status">节点数量：{serverCount}</div>
  ),
}));

import { ForbiddenError } from "@/lib/errors";
import VpsStatusPage from "../page";

describe("VpsStatusPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue({ userId: "user_1", username: "viewer", roles: ["viewer"] });
    sessionHasPermissionMock.mockReturnValue(true);
    countServerProfilesMock.mockResolvedValue(1);
  });

  it("refuses the page without health:read through the shared permission guard", async () => {
    sessionHasPermissionMock.mockReturnValueOnce(false);
    await expect(VpsStatusPage()).rejects.toBeInstanceOf(ForbiddenError);
    expect(requireSessionMock).toHaveBeenCalledWith("/vps-status");
    expect(countServerProfilesMock).not.toHaveBeenCalled();
  });

  it("renders VPS status client with server count", async () => {
    render(await VpsStatusPage());
    expect(countServerProfilesMock).toHaveBeenCalledOnce();
    expect(screen.getByTestId("vps-status")).toHaveTextContent("节点数量：1");
  });
});
