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

  it("refuses to mint a session cookie (login must go through /api/login)", async () => {
    const formData = new FormData();
    formData.set("username", "admin");
    formData.set("password", "19970103");

    await expect(login(null, formData)).resolves.toEqual({
      error: "登录服务暂时不可用，请稍后再试",
    });
    expect(authenticateUser).not.toHaveBeenCalled();
    expect(createSessionToken).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("returns a system error even when credentials would have been valid", async () => {
    const formData = new FormData();
    formData.set("username", "admin");
    formData.set("password", "wrong-password");

    await expect(login(null, formData)).resolves.toEqual({
      error: "登录服务暂时不可用，请稍后再试",
    });
    expect(authenticateUser).not.toHaveBeenCalled();
  });
});
