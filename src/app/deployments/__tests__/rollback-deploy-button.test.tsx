import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/toast-provider";
import { I18nProvider } from "@/lib/i18n/provider";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { RollbackDeployButton } from "../rollback-deploy-button";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));

const mockedFetch = vi.mocked(csrfFetch);

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider initialLocale="zh">
      <ToastProvider>{children}</ToastProvider>
    </I18nProvider>
  );
}

describe("RollbackDeployButton", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    refresh.mockReset();
  });

  it("requires an inline confirmation before submitting rollback", async () => {
    const user = userEvent.setup();
    mockedFetch.mockResolvedValueOnce(undefined);

    render(<RollbackDeployButton runId="run_1" templateName="Nginx" />, { wrapper });

    // First click enters confirmation mode
    await user.click(screen.getByRole("button", { name: /执行真实回滚/ }));

    // Warning text should appear
    expect(screen.getByText(/确认执行部署/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /确认回滚/ })).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();

    // Second click (confirm) actually submits
    await user.click(screen.getByRole("button", { name: /确认回滚/ }));

    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith("/api/deployments/run_1/rollback", {
        method: "POST",
        body: expect.any(String),
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("cancels the inline confirmation without submitting rollback", async () => {
    const user = userEvent.setup();

    render(<RollbackDeployButton runId="run_1" templateName="Nginx" />, { wrapper });

    await user.click(screen.getByRole("button", { name: /执行真实回滚/ }));
    // Cancel button appears in confirmation mode
    await user.click(screen.getByRole("button", { name: /取消/ }));

    expect(screen.queryByRole("button", { name: /确认回滚/ })).not.toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
