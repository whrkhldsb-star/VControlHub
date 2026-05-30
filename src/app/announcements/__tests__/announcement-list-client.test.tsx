import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { ToastProvider } from "@/components/toast-provider";
import { AnnouncementList } from "../announcement-list-client";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

const announcements = [
  {
    id: "ann-1",
    title: "维护公告",
    body: "今晚维护",
    level: "info",
    pinned: false,
    startsAt: "2026-05-30T00:00:00.000Z",
    expiresAt: null,
  },
];

function renderList() {
  return render(
    <ToastProvider>
      <AnnouncementList items={announcements} canManage />
    </ToastProvider>,
  );
}

describe("AnnouncementList", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(csrfFetch).mockResolvedValue({});
  });

  it("uses an accessible confirmation dialog instead of native confirm before deleting", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    renderList();

    await userEvent.click(screen.getByRole("button", { name: "删除公告 维护公告" }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "删除公告" })).toBeInTheDocument();
    expect(csrfFetch).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("dialog", { name: "删除公告" })).not.toBeInTheDocument();
    expect(csrfFetch).not.toHaveBeenCalled();
  });

  it("deletes only after modal confirmation and shows success feedback", async () => {
    renderList();

    await userEvent.click(screen.getByRole("button", { name: "删除公告 维护公告" }));
    await userEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/announcements?id=ann-1", { method: "DELETE" }));
    expect(screen.queryByText("维护公告")).not.toBeInTheDocument();
    expect(screen.getByText("公告已删除")).toBeInTheDocument();
  });

  it("keeps the dialog open and displays API errors", async () => {
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("没有权限"));
    renderList();

    await userEvent.click(screen.getByRole("button", { name: "删除公告 维护公告" }));
    await userEvent.click(screen.getByRole("button", { name: "确认删除" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("没有权限");
    expect(screen.getByRole("dialog", { name: "删除公告" })).toBeInTheDocument();
    expect(screen.getAllByText("维护公告").length).toBeGreaterThanOrEqual(1);
  });
});
