import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

import { csrfFetch } from "@/lib/auth/csrf-client";
import { CreateTicketForm } from "../create-ticket-form";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

describe("CreateTicketForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes the current route after creating a ticket without forcing a full page reload", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockResolvedValueOnce({ id: "ticket_1" });

    render(<CreateTicketForm />);

    await user.type(screen.getByLabelText("标题"), "无法连接 VPS");
    await user.type(screen.getByLabelText("描述"), "SSH 连接一直超时");
    await user.selectOptions(screen.getByLabelText("优先级"), "HIGH");
    await user.click(screen.getByRole("button", { name: "提交工单" }));

    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "无法连接 VPS", description: "SSH 连接一直超时", priority: "HIGH" }),
    }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
