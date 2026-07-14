import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateTicketForm } from "../create-ticket-form";
import { csrfFetch } from "@/lib/auth/csrf-client";

const refresh = vi.fn();
const addToast = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));
vi.mock("@/components/toast-provider", () => ({ useToast: () => ({ addToast }) }));
vi.mock("@/lib/i18n/use-locale", async () => {
  const translations = await import("@/lib/i18n/translations");
  return { useI18n: () => ({ locale: "en", t: (key: string) => translations.t(key, "en") }) };
});

describe("CreateTicketForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(csrfFetch).mockResolvedValue(undefined);
  });

  it("submits the selected category to the ticket API", async () => {
    const user = userEvent.setup();
    render(<CreateTicketForm locale="en" />);

    await user.type(screen.getByLabelText("Title"), "API latency");
    await user.selectOptions(screen.getByLabelText("Category"), "incident");
    await user.type(screen.getByLabelText("Description"), "Latency exceeds the SLO");
    await user.click(screen.getByRole("button", { name: "Submit ticket" }));

    await waitFor(() => expect(csrfFetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(vi.mocked(csrfFetch).mock.calls[0]?.[1]?.body))).toMatchObject({
      subject: "API latency",
      category: "incident",
      description: "Latency exceeds the SLO",
    });
  });
});
