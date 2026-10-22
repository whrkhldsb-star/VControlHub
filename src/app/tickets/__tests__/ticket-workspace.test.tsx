import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";

import { I18nProvider } from "@/lib/i18n/provider";
import { TicketWorkspace, type TicketWorkspaceTicket } from "../ticket-workspace";

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));

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

/** The tickets API as the workspace uses it: filters and paging happen on the server. */
function serve(all: TicketWorkspaceTicket[]) {
  vi.mocked(csrfFetch).mockImplementation(async (input: unknown) => {
    const url = new URL(String(input), "https://local");
    const matches = all.filter((ticket) =>
      (!url.searchParams.get("status") || ticket.status === url.searchParams.get("status"))
      && (!url.searchParams.get("priority") || ticket.priority === url.searchParams.get("priority"))
      && (!url.searchParams.get("search") || ticket.title.toLowerCase().includes(url.searchParams.get("search")!.toLowerCase())));
    if (url.searchParams.get("view") === "board") {
      const column = (status: string) => {
        const rows = matches.filter((ticket) => ticket.status === status);
        return { tickets: rows, total: rows.length };
      };
      return { columns: { OPEN: column("OPEN"), IN_PROGRESS: column("IN_PROGRESS"), RESOLVED: column("RESOLVED"), CLOSED: column("CLOSED") } } as never;
    }
    const page = Number(url.searchParams.get("page") ?? "1");
    return { tickets: matches.slice((page - 1) * 30, page * 30), total: matches.length, page } as never;
  });
}

const firstPage = (rows: TicketWorkspaceTicket[]) => ({ tickets: rows.slice(0, 30), total: rows.length, page: 1 });

describe("TicketWorkspace", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/tickets");
    vi.mocked(csrfFetch).mockReset();
    serve(tickets);
  });

  it("asks the server for each filter and shows what it returns", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <TicketWorkspace initialPage={firstPage(tickets)} initialBoard={null} canManage now="2026-01-02T00:00:00.000Z" />
      </I18nProvider>,
    );

    // The server rendered the first page: nothing is fetched again.
    expect(screen.getByText("Database outage")).toBeInTheDocument();
    expect(screen.getByText("Add staging VPS")).toBeInTheDocument();
    expect(csrfFetch).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText("Status"), "OPEN");
    await waitFor(() => expect(screen.queryByText("Add staging VPS")).not.toBeInTheDocument());
    expect(screen.getByText("Database outage")).toBeInTheDocument();
    expect(String(vi.mocked(csrfFetch).mock.calls.at(-1)![0])).toContain("status=OPEN");

    await user.type(screen.getByLabelText("Search title or description"), "database");
    await waitFor(() => expect(String(vi.mocked(csrfFetch).mock.calls.at(-1)![0])).toContain("search=database"));

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("Add staging VPS")).toBeInTheDocument();
  });

  it("shows a ticket created meanwhile once the page renders again (router.refresh)", async () => {
    // The first page lives in state: a new server render used to leave it as
    // it was, so a ticket just created did not appear until a filter changed.
    const view = (rows: TicketWorkspaceTicket[]) => (
      <I18nProvider initialLocale="en">
        <TicketWorkspace initialPage={firstPage(rows)} initialBoard={null} canManage now="2026-01-02T00:00:00.000Z" />
      </I18nProvider>
    );
    const { rerender } = render(view(tickets));
    const created = { ...tickets[0]!, id: "t3", title: "Printer on fire", updatedAt: "2026-01-01T02:00:00.000Z" };
    serve([created, ...tickets]);

    rerender(view([created, ...tickets]));

    expect(await screen.findByText("Printer on fire")).toBeInTheDocument();
  });

  it("reaches tickets beyond any loaded window: paging and totals come from the server", async () => {
    // 75 open tickets; the list used to filter what one load had brought.
    const many = Array.from({ length: 75 }, (_, i) => ({ ...tickets[0]!, id: `open-${i}`, title: `Open ticket ${i}` }));
    serve(many);
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <TicketWorkspace initialPage={firstPage(many)} initialBoard={null} canManage now="2026-01-02T00:00:00.000Z" />
      </I18nProvider>,
    );
    expect(screen.getByText("Tickets (75)")).toBeInTheDocument();
    const next = () => screen.getByRole("button", { name: "Next" });
    await user.click(next());
    expect(await screen.findByText("Open ticket 59")).toBeInTheDocument();
    await user.click(next());
    expect(await screen.findByText("Open ticket 74")).toBeInTheDocument();
    expect(String(vi.mocked(csrfFetch).mock.calls.at(-1)![0])).toContain("page=3");
  });

  it("shows only the newest request's answer", async () => {
    // The status filter answers after the priority one that followed it.
    const answers: Array<(value: unknown) => void> = [];
    vi.mocked(csrfFetch).mockImplementation(() => new Promise((resolve) => { answers.push(resolve); }) as never);
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <TicketWorkspace initialPage={firstPage(tickets)} initialBoard={null} canManage now="2026-01-02T00:00:00.000Z" />
      </I18nProvider>,
    );
    await user.selectOptions(screen.getByLabelText("Status"), "IN_PROGRESS");
    await waitFor(() => expect(answers).toHaveLength(1));
    await user.selectOptions(screen.getByLabelText("Priority"), "URGENT");
    await waitFor(() => expect(answers).toHaveLength(2));
    await act(async () => answers[1]!({ tickets: [], total: 0, page: 1 }));
    await act(async () => answers[0]!({ tickets: [tickets[1]], total: 1, page: 1 }));
    expect(screen.queryByText("Add staging VPS")).not.toBeInTheDocument();
    expect(screen.getByText("Tickets (0)")).toBeInTheDocument();
  });

  it("switches between list and board and renders SLA due information", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider initialLocale="en">
        <TicketWorkspace initialPage={firstPage(tickets)} initialBoard={null} canManage={false} now="2026-01-02T00:00:00.000Z" />
      </I18nProvider>,
    );

    expect(screen.getAllByText("SLA breached").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/SLA due:/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Board" }));
    const openColumn = await screen.findByTestId("ticket-column-OPEN");
    const progressColumn = screen.getByTestId("ticket-column-IN_PROGRESS");
    expect(within(openColumn).getByText("Database outage")).toBeInTheDocument();
    expect(within(progressColumn).getByText("Add staging VPS")).toBeInTheDocument();
    expect(String(vi.mocked(csrfFetch).mock.calls.at(-1)![0])).toContain("view=board");
  });

  it("judges SLA labels at the time the list was loaded, not at the first render", async () => {
    // At 09:00 the ticket was due soon; an hour later the "breached" filter
    // returned it, but its label still read "due soon".
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const due: TicketWorkspaceTicket = { ...tickets[0]!, id: "t-due", title: "Due at 09:30", slaDueAt: "2026-01-02T09:30:00.000Z" };
      serve([due]);
      vi.setSystemTime(new Date("2026-01-02T09:00:00.000Z"));
      const user = userEvent.setup({ advanceTimers: () => undefined });
      render(
        <I18nProvider initialLocale="en">
          <TicketWorkspace initialPage={firstPage([due])} initialBoard={null} canManage now="2026-01-02T09:00:00.000Z" />
        </I18nProvider>,
      );
      const card = () => screen.getByText("Due at 09:30").closest("[data-ticket-card], article, li") ?? screen.getByText("Due at 09:30").parentElement!.parentElement!;
      expect(within(card() as HTMLElement).getByText("Due soon")).toBeInTheDocument();

      vi.setSystemTime(new Date("2026-01-02T10:00:00.000Z"));
      await user.selectOptions(screen.getByLabelText("SLA status"), "breached");
      await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith(expect.stringContaining("slaStatus=breached")));
      await waitFor(() => expect(within(card() as HTMLElement).getByText("SLA breached")).toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });
});
