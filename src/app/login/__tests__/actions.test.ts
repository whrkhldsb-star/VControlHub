import { beforeEach, describe, expect, it, vi } from "vitest";

import { login } from "@/app/login/actions";
import { authenticateUser } from "@/lib/auth/service";
import { createSessionToken } from "@/lib/auth/session";

const { setMock, redirectMock } = vi.hoisted(() => ({
  setMock: vi.fn(),
  redirectMock: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    set: setMock,
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@/lib/auth/service", () => ({
  authenticateUser: vi.fn(),
}));

vi.mock("@/lib/auth/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/session")>("@/lib/auth/session");
  return {
    ...actual,
    createSessionToken: vi.fn(),
  };
});

describe("login action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores session cookie and redirects after successful login", async () => {
	vi.mocked(authenticateUser).mockResolvedValueOnce({
		id: "u_1",
		username: "admin",
		displayName: "Admin",
		mustChangePassword: true,
		twoFactorEnabled: false,
		twoFactorSecret: null,
		status: "PENDING_PASSWORD_RESET",
		currentTeamId: null,
		roles: ["admin"],
		permissions: ["command:execute"],
		preferences: {
			defaultPage: "/",
			dashboardWidgets: ["server-status", "quick-links", "analytics", "audit-log"],
			notificationsEnabled: true,
			notificationSound: true,
			autoRefreshInterval: 30,
			autoProbeEnabled: true,
			autoProbeIntervalSec: 60,
		},
	});
    vi.mocked(createSessionToken).mockResolvedValueOnce("signed-token");

    const formData = new FormData();
    formData.set("username", "admin");
    formData.set("password", "19970103");

    await expect(login(null, formData)).rejects.toThrow("REDIRECT:/");
    expect(setMock).toHaveBeenCalledWith(
      expect.stringMatching(/[-_]session$/),
      "signed-token",
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it("uses the user's default page when there is no explicit next target", async () => {
	vi.mocked(authenticateUser).mockResolvedValueOnce({
		id: "u_1",
		username: "admin",
		displayName: "Admin",
		mustChangePassword: false,
		twoFactorEnabled: false,
		twoFactorSecret: null,
		status: "ACTIVE",
		currentTeamId: null,
		roles: ["admin"],
		permissions: ["command:execute"],
		preferences: {
			defaultPage: "/files",
			dashboardWidgets: ["server-status"],
			notificationsEnabled: true,
			notificationSound: true,
			autoRefreshInterval: 30,
			autoProbeEnabled: true,
			autoProbeIntervalSec: 60,
		},
	});
    vi.mocked(createSessionToken).mockResolvedValueOnce("signed-token");

    const formData = new FormData();
    formData.set("username", "admin");
    formData.set("password", "19970103");

    await expect(login(null, formData)).rejects.toThrow("REDIRECT:/files");
  });

  it("returns an error message for invalid credentials", async () => {
    vi.mocked(authenticateUser).mockResolvedValueOnce(null);

    const formData = new FormData();
    formData.set("username", "admin");
    formData.set("password", "wrong-password");

    await expect(login(null, formData)).resolves.toEqual({
      error: "用户名或密码错误",
    });
  });
});
