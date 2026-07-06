import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { ScheduleBackupForm } from "../schedule-backup-form";

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));

const schedulesResponse = {
  ok: true,
  json: async () => ({
    schedules: [
      {
        id: "sched_1",
        name: "每日数据库备份",
        cronExpression: "0 3 * * *",
        backupType: "DATABASE",
        note: null,
        retentionDays: null,
        status: "ACTIVE",
        lastRunAt: null,
        nextRunAt: "2026-01-02T03:00:00.000Z",
        lastResult: null,
        runCount: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  }),
};

describe("ScheduleBackupForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces toggle failures instead of silently swallowing them", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce(schedulesResponse)
      .mockRejectedValueOnce(new Error("调度器不可用"));

    renderWithI18n(<ScheduleBackupForm />, { locale: "zh" });

    await user.click(await screen.findByRole("button", { name: "暂停/恢复" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("调度器不可用"));
  });

  it("keeps the delete dialog open and shows an error when delete fails", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce(schedulesResponse)
      .mockRejectedValueOnce(new Error("删除失败：仍有运行中的任务"));

    renderWithI18n(<ScheduleBackupForm />, { locale: "zh" });

    await user.click(await screen.findByRole("button", { name: "删除" }));
    const dialog = await screen.findByRole("dialog", { name: "确认删除" });
    await user.click(within(dialog).getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("删除失败：仍有运行中的任务"));
    expect(screen.getByRole("dialog", { name: "确认删除" })).toBeInTheDocument();
  });
});
