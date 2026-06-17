/**
 * TR-054 R10G.x (drive-by): AnnouncementEditModal 标题 i18n.
 *
 *  - 改前: `<h3>编辑公告</h3>` 硬编码中文
 *  - 改后: `{t("announcementsPage.edit.title")}` 走字典
 *  - 回归测试断言 modal title 在 zh 渲染为 "编辑公告", 在 en 渲染为 "Edit announcement"
 *  - 验证 PATCH /api/announcements 调用时 title/content/type/pinned payload 正确
 */

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { AnnouncementEditModal } from "../announcement-edit-modal";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

const baseAnnouncement = {
  id: "ann-1",
  title: "维护公告",
  body: "今晚维护",
  level: "info",
  pinned: false,
  startsAt: "2026-05-30T00:00:00.000Z",
  expiresAt: null,
};

describe("AnnouncementEditModal (R10G drive-by: edit title i18n)", () => {
  beforeEach(() => {
    vi.mocked(csrfFetch).mockReset();
  });

  it("renders the i18n title '编辑公告' in zh locale", () => {
    render(
      <AnnouncementEditModal
        announcement={baseAnnouncement}
        onClose={() => {}}
        onSaved={() => {}}
      />,
      { locale: "zh" },
    );
    expect(screen.getByRole("heading", { name: "编辑公告", level: 3 })).toBeInTheDocument();
  });

  it("renders the i18n title 'Edit announcement' in en locale", () => {
    render(
      <AnnouncementEditModal
        announcement={baseAnnouncement}
        onClose={() => {}}
        onSaved={() => {}}
      />,
      { locale: "en" },
    );
    expect(screen.getByRole("heading", { name: "Edit announcement", level: 3 })).toBeInTheDocument();
  });

  it("PATCHes /api/announcements with the merged payload on save", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockResolvedValueOnce({
      announcement: { ...baseAnnouncement, title: "新标题", body: "新内容" },
    });
    const onSaved = vi.fn();
    const onClose = vi.fn();

    render(
      <AnnouncementEditModal
        announcement={baseAnnouncement}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    await user.clear(screen.getByLabelText("标题"));
    await user.type(screen.getByLabelText("标题"), "新标题");
    await user.clear(screen.getByLabelText("内容"));
    await user.type(screen.getByLabelText("内容"), "新内容");

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(csrfFetch).toHaveBeenCalledWith("/api/announcements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "ann-1",
          title: "新标题",
          content: "新内容",
          type: "info",
          pinned: false,
        }),
      });
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
