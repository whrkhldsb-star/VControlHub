import { screen, waitFor, within } from "@testing-library/react";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { CancelCommandButton } from "../cancel-command-button";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }) }));

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn() }));

describe("CancelCommandButton", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(csrfFetch).mockResolvedValue({ command: { id: "cmd1", status: "CANCELLED" } });
  });

  it("confirms cancellation through the command API and refreshes the server-rendered request list", async () => {
    render(<CancelCommandButton commandRequestId="cmd1" commandTitle="Restart nginx" />, { locale: "en" });

    await userEvent.click(screen.getByRole("button", { name: "Cancel command: Restart nginx" }));
    expect(screen.getByRole("dialog", { name: "Cancel command" })).toHaveTextContent("Restart nginx");

    await userEvent.type(screen.getByLabelText("Cancel reason (optional)"), "wrong maintenance window");
    await userEvent.click(screen.getByRole("button", { name: "Cancel command" }));

    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/commands", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ action: "cancel", commandRequestId: "cmd1", reason: "wrong maintenance window" }) })));
    expect(refreshMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("Cancel request submitted; task status refreshed.");
  });

  it("keeps the dialog open and surfaces API errors distinctly", async () => {
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("Current command request has ended, cannot cancel"));
    render(<CancelCommandButton commandRequestId="cmd1" commandTitle="Restart nginx" />, { locale: "en" });

    await userEvent.click(screen.getByRole("button", { name: "Cancel command: Restart nginx" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel command" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Current command request has ended, cannot cancel");
    const dialog = screen.getByRole("dialog", { name: "Cancel command" });
    // In the dialog that stays open: it was written under the button on the page, behind it.
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Current command request has ended, cannot cancel");
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
