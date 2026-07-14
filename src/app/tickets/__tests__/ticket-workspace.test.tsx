import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TicketWorkspace, type TicketWorkspaceTicket } from "../ticket-workspace";

const tickets: TicketWorkspaceTicket[] = [
  {
    id: "t1",
    title: "Database outage",
    description: "Primary database is unavailable",
    status: "OPEN",
    priority: "URGENT",
    category: "incident",
    slaDueAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2025-12-31T22:00:00.000Z",
    updatedAt: "2025-12-31T23:00:00.000Z",
    creator: { username: "alice", displayName: "Alice" },
    assignee: null,
  },
  {
    id: "t2",
    title: "Add staging VPS",
    description: "Need another staging node",
    status: "IN_PROGRESS",
    priority: "NORMAL",
    category: "request",
    slaDueAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T01:00:00.000Z",
    creator: { username: "bob", displayName: null },
    assignee: { username: "ops", displayName: "Ops" },
  },
];

describe("TicketWorkspace", () => {
  it("filters tickets by search, status, priority, category and SLA", async () => {
    const user = userEvent.setup();
    render(<TicketWorkspace initialTickets={tickets} canManage locale="en" now="2026-01-02T00:00:00.000Z" />);

    expect(screen.getByText("Database outage")).toBeInTheDocument();
    expect(screen.getByText("Add staging VPS")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Status"), "OPEN");
    expect(screen.getByText("Database outage")).toBeInTheDocument();
    expect(screen.queryByText("Add staging VPS")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Priority"), "URGENT");
    await user.selectOptions(screen.getByLabelText("Category"), "incident");
    await user.selectOptions(screen.getByLabelText("SLA status"), "breached");
    await user.type(screen.getByLabelText("Search title or description"), "database");
    expect(screen.getByText("Database outage")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Add staging VPS")).toBeInTheDocument();
  });

  it("switches between list and board and renders SLA due information", async () => {
    const user = userEvent.setup();
    render(<TicketWorkspace initialTickets={tickets} canManage={false} locale="en" now="2026-01-02T00:00:00.000Z" />);

    expect(screen.getAllByText("SLA breached").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/SLA due:/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Board" }));
    const openColumn = screen.getByTestId("ticket-column-OPEN");
    const progressColumn = screen.getByTestId("ticket-column-IN_PROGRESS");
    expect(within(openColumn).getByText("Database outage")).toBeInTheDocument();
    expect(within(progressColumn).getByText("Add staging VPS")).toBeInTheDocument();
  });
});
