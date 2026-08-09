import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { TicketDetailClient, type Ticket } from "../[id]/ticket-detail-client";

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));

const initial: Ticket = {
  id: "ticket-1",
  title: "Database outage",
  description: "Primary database is unavailable",
  status: "OPEN",
  priority: "URGENT",
  createdBy: "user-1",
  assigneeId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  closedAt: null,
  creator: { id: "user-1", username: "alice", displayName: "Alice" },
  assignee: null,
  comments: [],
};

const emptyTimeline = { events: [], related: { server: null, command: null, reverseTickets: [] } };

describe("TicketDetailClient", () => {
  beforeEach(() => {
    vi.mocked(csrfFetch).mockReset();
    vi.mocked(csrfFetch).mockImplementation(async (input) => {
      if (String(input).endsWith("/timeline")) return emptyTimeline;
      throw new Error(`Unexpected request: ${String(input)}`);
    });
  });

  it("restores the previous assignee and exposes the failure as a dismissible alert", async () => {
    vi.mocked(csrfFetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith("/timeline")) return emptyTimeline;
      if ((init as RequestInit | undefined)?.method === "PATCH") throw new Error("Assignment API unavailable");
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    render(<TicketDetailClient initial={initial} canManage users={[{ id: "user-2", username: "ops", displayName: "Ops" }]} />, { locale: "en" });

    const assignee = await screen.findByRole("combobox", { name: "Assign to" });
    fireEvent.change(assignee, { target: { value: "user-2" } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Assignment API unavailable");
    expect(assignee).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("prevents overlapping mutations while a comment is being submitted", async () => {
    let resolveComment!: (value: unknown) => void;
    const pendingComment = new Promise((resolve) => { resolveComment = resolve; });
    vi.mocked(csrfFetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith("/timeline") && !init?.method) return emptyTimeline;
      if ((init as RequestInit | undefined)?.method === "POST" && !String(input).endsWith("/timeline")) return pendingComment;
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    render(<TicketDetailClient initial={initial} canManage users={[]} />, { locale: "en" });

    fireEvent.change(await screen.findByLabelText("Add a comment"), { target: { value: "Investigating" } });
    fireEvent.click(screen.getByRole("button", { name: "Send comment" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Move to In Progress" })).toBeDisabled();
    resolveComment({ comment: { id: "comment-1", body: "Investigating", createdAt: "2026-01-01T01:00:00Z", author: initial.creator } });
    await waitFor(() => expect(screen.getByLabelText("Add a comment")).toHaveValue(""));
  });

  it("localizes statuses for linked commands and tickets", async () => {
    vi.mocked(csrfFetch).mockResolvedValue({
      events: [],
      related: {
        server: null,
        command: { id: "command-1", title: "Restart database", command: "systemctl restart db", status: "PENDING_APPROVAL", createdAt: initial.createdAt },
        reverseTickets: [{ id: "ticket-2", title: "Database latency", status: "IN_PROGRESS" }],
      },
    });

    render(<TicketDetailClient initial={initial} canManage={false} />, { locale: "zh" });

    expect(await screen.findByText("Restart database · 等待审批")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Database latency · 处理中" })).toBeInTheDocument();
  });
});
