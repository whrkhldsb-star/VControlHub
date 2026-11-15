import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { ToastProvider } from "@/components/toast-provider";
import { AnnouncementList } from "../announcement-list-client";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

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
  {
    id: "ann-2",
    title: "功能上线",
    body: "新看板已发布",
    level: "success",
    pinned: false,
    startsAt: "2026-05-31T00:00:00.000Z",
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

  it("shows a visible label for announcement search and filters by label-based input", async () => {
    renderList();

    expect(screen.getByText("搜索公告")).toBeInTheDocument();
    const searchInput = screen.getByRole("searchbox", { name: "搜索公告" });

    await userEvent.type(searchInput, "看板");

    expect(screen.getByText("功能上线")).toBeInTheDocument();
    expect(screen.queryByText("维护公告")).not.toBeInTheDocument();
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

  it("offers an administrator the first announcement, with nothing to search before it", async () => {
    const onCreate = vi.fn();
    render(
      <ToastProvider>
        <AnnouncementList items={[]} canManage onCreate={onCreate} />
      </ToastProvider>,
    );
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByText("暂无公告")).toBeInTheDocument();
    expect(screen.getByText("发布后，所有登录的账号都会在这里和通知区域看到。")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "发布公告" }));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("tells a reader where announcements come from", () => {
    render(
      <ToastProvider>
        <AnnouncementList items={[]} canManage={false} />
      </ToastProvider>,
    );
    expect(screen.getByText("管理员发布的公告会显示在这里。")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("labels the level filter and says how many are shown", () => {
    renderList();
    expect(screen.getByLabelText("按级别过滤")).toHaveValue("ALL");
    expect(screen.getByText("2 条")).toBeInTheDocument();
  });
});
