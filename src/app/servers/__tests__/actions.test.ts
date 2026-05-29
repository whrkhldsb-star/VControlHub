import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerProfileMock, requirePermissionMock, revalidatePathMock } =
  vi.hoisted(() => ({
    createServerProfileMock: vi.fn(),
    requirePermissionMock: vi.fn(),
    revalidatePathMock: vi.fn(),
  }));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: requirePermissionMock,
}));

vi.mock("@/lib/server/service", () => ({
  createServerProfile: createServerProfileMock,
  createSshKey: vi.fn(),
  deleteServerProfile: vi.fn(),
  setServerDirectGatewayEnabled: vi.fn(),
  toggleServerEnabled: vi.fn(),
}));

describe("server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermissionMock.mockResolvedValue({ userId: "user_1" });
  });

  it("returns a success message with onboarding warnings when direct setup needs retry", async () => {
    createServerProfileMock.mockResolvedValueOnce({
      onboardingWarnings: [
        "目标服务器直连自动配置失败：connect ETIMEDOUT。VPS 节点和存储节点已创建，可稍后在 VPS 管理面板重试启用直连。",
      ],
    });
    const { createServerAction } = await import("../actions");
    const formData = new FormData();
    formData.set("name", "direct-node");
    formData.set("host", "203.0.113.10");
    formData.set("port", "22");
    formData.set("username", "root");
    formData.set("connectionType", "SSH_KEY");
    formData.set("sshKeyId", "key_1");
    formData.set("enableDirectGateway", "on");
    formData.set("storagePath", "/data/vch-files");

    const result = await createServerAction(null, formData);

    expect(result.error).toBeUndefined();
    expect(result.success).toContain("VPS 节点已纳管");
    expect(result.success).toContain("自动配置项需要处理");
    expect(result.success).toContain("connect ETIMEDOUT");
    expect(createServerProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enableDirectGateway: true,
        storagePath: "/data/vch-files",
      }),
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/servers");
  });
});
