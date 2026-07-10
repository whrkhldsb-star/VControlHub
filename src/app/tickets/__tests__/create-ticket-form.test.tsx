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
import { ToastProvider } from "@/components/toast-provider";

describe("CreateTicketForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes the current route after creating a ticket without forcing a full page reload", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockResolvedValueOnce({ id: "ticket_1" });

    render(<ToastProvider><CreateTicketForm /></ToastProvider>, { locale: "en" });

    await user.type(screen.getByLabelText("Title"), "Cannot connect to VPS");
    await user.type(screen.getByLabelText("Description"), "SSH connection keeps timing out");
    await user.selectOptions(screen.getByLabelText("Priority"), "HIGH");
    await user.click(screen.getByRole("button", { name: "Submit ticket" }));

    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "Cannot connect to VPS", description: "SSH connection keeps timing out", priority: "HIGH" }),
    }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
