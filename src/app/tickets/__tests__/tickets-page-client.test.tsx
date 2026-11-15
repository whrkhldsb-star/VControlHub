import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

vi.mock("../ticket-workspace", () => ({
  TicketWorkspace: ({ onCreate }: { onCreate?: () => void }) => (
    <div data-testid="workspace">{onCreate ? <button type="button" onClick={onCreate}>empty list: new ticket</button> : null}</div>
  ),
}));
vi.mock("../create-ticket-form", () => ({
  CreateTicketForm: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose}>
      ticket fields
    </button>
  ),
}));

import { TicketsPageClient } from "../tickets-page-client";

function renderPage(canCreate: boolean) {
  render(
    <TicketsPageClient
      header={{ title: "工单与请求", description: "提交资源、支持和运维请求" }}
      canCreate={canCreate}
      servers={[]}
      stats={<div>figures</div>}
      workspace={{ initialPage: null, initialBoard: null, canManage: false, now: new Date(0).toISOString() }}
    />,
  );
}

describe("TicketsPageClient", () => {
  it("opens the new-ticket form from the header instead of showing it above the list", async () => {
    const user = userEvent.setup();
    renderPage(true);
    expect(screen.queryByText("ticket fields")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新建工单" }));
    expect(screen.getByRole("heading", { name: "新建工单" })).toBeInTheDocument();
    expect(screen.getByText("ticket fields")).toBeInTheDocument();
    // While the form is open neither the header nor the empty list offers it again.
    expect(screen.queryByRole("button", { name: "新建工单" })).not.toBeInTheDocument();
    expect(screen.queryByText("empty list: new ticket")).not.toBeInTheDocument();

    await user.click(screen.getByText("ticket fields"));
    expect(screen.queryByText("ticket fields")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建工单" })).toBeInTheDocument();
  });

  it("opens it from the empty list too", async () => {
    const user = userEvent.setup();
    renderPage(true);
    await user.click(screen.getByText("empty list: new ticket"));
    expect(screen.getByText("ticket fields")).toBeInTheDocument();
  });

  it("offers nothing to an account that cannot file tickets", () => {
    renderPage(false);
    expect(screen.queryByRole("button", { name: "新建工单" })).not.toBeInTheDocument();
    expect(screen.queryByText("empty list: new ticket")).not.toBeInTheDocument();
    expect(screen.getByText("figures")).toBeInTheDocument();
  });
});
