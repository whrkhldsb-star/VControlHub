import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { csrfFetch } = vi.hoisted(() => ({
  csrfFetch: vi.fn(),
}));

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch }));
vi.mock("@/lib/i18n/use-locale", () => ({
  useI18n: () => ({
    t: (k: string) => k,
    locale: "zh" as const,
  }),
}));

import { AiHostedApprovalCard } from "../ai-hosted-approval-card";

describe("AiHostedApprovalCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    csrfFetch.mockResolvedValue({});
  });

  it("sends confirm (not approve) for requester-facing primary action", async () => {
    const user = userEvent.setup();
    render(
      <AiHostedApprovalCard
        action={{
          id: "act_1",
          actionName: "Restart nginx",
          actionType: "restart_service",
          riskLevel: "high",
          params: { service: "nginx" },
          server: { id: "s1", name: "edge", host: "10.0.0.1" },
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "aiHostedApproval.confirmAction" }));
    await waitFor(() => {
      expect(csrfFetch).toHaveBeenCalledWith(
        "/api/ai/hosted-actions/act_1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ action: "confirm" }),
        }),
      );
    });
  });

  it("rejects with a reason payload", async () => {
    const user = userEvent.setup();
    render(
      <AiHostedApprovalCard
        action={{
          id: "act_2",
          actionName: "Danger",
          actionType: "execute_command",
          riskLevel: "critical",
          params: {},
        }}
      />,
    );

    await user.type(screen.getByPlaceholderText("aiHostedApproval.rejectReasonPlaceholder"), "nope");
    await user.click(screen.getByRole("button", { name: "aiHostedApproval.reject" }));
    await waitFor(() => {
      expect(csrfFetch).toHaveBeenCalledWith(
        "/api/ai/hosted-actions/act_2",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ action: "reject", reason: "nope" }),
        }),
      );
    });
  });
});
