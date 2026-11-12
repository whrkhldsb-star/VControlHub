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

  it("keeps the ticket as it was written when it could not be filed", async () => {
    // React clears the fields of a form whose action has answered, a refusal included: the description, the
    // category and the priority were gone, with only "Failed to create" left to read.
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("Too many tickets were opened in the last hour"));
    render(<CreateTicketForm locale="en" />);

    await user.type(screen.getByLabelText("Title"), "API latency");
    await user.selectOptions(screen.getByLabelText("Category"), "incident");
    await user.selectOptions(screen.getByLabelText("Priority"), "URGENT");
    await user.type(screen.getByLabelText("Description"), "Latency exceeds the SLO");
    await user.click(screen.getByRole("button", { name: "Submit ticket" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many tickets were opened in the last hour");
    expect(screen.getByLabelText("Title")).toHaveValue("API latency");
    expect(screen.getByLabelText("Category")).toHaveValue("incident");
    expect(screen.getByLabelText("Priority")).toHaveValue("URGENT");
    expect(screen.getByLabelText("Description")).toHaveValue("Latency exceeds the SLO");
    // Said once, in the form: it was also sent as a toast with the same words.
    expect(addToast).not.toHaveBeenCalledWith("error", expect.anything());
  });

  it("starts a new ticket empty after one was filed", async () => {
    const user = userEvent.setup();
    render(<CreateTicketForm locale="en" />);
    await user.type(screen.getByLabelText("Title"), "API latency");
    await user.type(screen.getByLabelText("Description"), "Latency exceeds the SLO");
    await user.click(screen.getByRole("button", { name: "Submit ticket" }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("success", "Ticket created"));
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.getByLabelText("Description")).toHaveValue("");
  });
});
