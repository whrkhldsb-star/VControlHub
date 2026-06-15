import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { ChangePasswordForm } from "../change-password-form";

const { mockUseActionState, mockUseSearchParams } = vi.hoisted(() => ({
  mockUseActionState: vi.fn(),
  mockUseSearchParams: vi.fn(),
}));
const routerPushMock = vi.fn();

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: (...args: unknown[]) => mockUseActionState(...args),
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
  useSearchParams: () => mockUseSearchParams(),
}));

vi.mock("../actions", () => ({
  changePasswordAction: vi.fn(),
}));

beforeEach(() => {
  mockUseSearchParams.mockReturnValue(new URLSearchParams(""));
  mockUseActionState.mockReturnValue([{}, vi.fn()]);
  routerPushMock.mockClear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ChangePasswordForm", () => {
  it("lets operators show and hide each password field while editing", async () => {
    const user = userEvent.setup();

    render(<ChangePasswordForm />);

    for (const label of ["当前密码", "新密码", "确认新密码"]) {

      const field = input.closest("div.grid");
      expect(field).not.toBeNull();
      const toggle = within(field as HTMLElement).getByRole("button", { name: `显示${label}` });
      expect(toggle).toHaveAttribute("aria-pressed", "false");

      await user.click(toggle);
      expect(input).toHaveAttribute("type", "text");
      expect(within(field as HTMLElement).getByRole("button", { name: `隐藏${label}` })).toHaveAttribute("aria-pressed", "true");

      await user.click(within(field as HTMLElement).getByRole("button", { name: `隐藏${label}` }));
      expect(input).toHaveAttribute("type", "password");
    }
  });
});

// TR-052: 改密成功后自动跳到落地页 dashboard.
describe("ChangePasswordForm TR-052 redirect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("改密成功后 1.5s 自动跳到 / (落地页 dashboard)", async () => {
    mockUseActionState.mockReturnValue([{ success: "密码已更新。" }, vi.fn()]);
    mockUseSearchParams.mockReturnValue(new URLSearchParams(""));

    render(<ChangePasswordForm />);

    expect(routerPushMock).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("密码已更新。");
    expect(screen.getByRole("status")).toHaveTextContent("1.5s 后自动跳到仪表盘");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(routerPushMock).toHaveBeenCalledWith("/");
  });

  it("改密成功后尊重 ?next= query 跳到指定路径 (1.5s 后)", async () => {
    mockUseActionState.mockReturnValue([{ success: "密码已更新。" }, vi.fn()]);
    mockUseSearchParams.mockReturnValue(new URLSearchParams("next=/servers"));

    render(<ChangePasswordForm />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(routerPushMock).toHaveBeenCalledWith("/servers");
  });

  it("?next= 以 // 开头 (协议相对 URL) 时回退到 /", async () => {
    mockUseActionState.mockReturnValue([{ success: "密码已更新。" }, vi.fn()]);
    mockUseSearchParams.mockReturnValue(new URLSearchParams("next=//evil.example.com"));

    render(<ChangePasswordForm />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(routerPushMock).toHaveBeenCalledWith("/");
  });

  it("未成功时 countdown / 跳转按钮都不显示", () => {
    mockUseActionState.mockReturnValue([{ error: "当前密码错误" }, vi.fn()]);
    render(<ChangePasswordForm />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "立即跳到仪表盘" })).not.toBeInTheDocument();
  });
});
