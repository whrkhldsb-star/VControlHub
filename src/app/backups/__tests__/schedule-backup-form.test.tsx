import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { ScheduleBackupForm } from "../schedule-backup-form";

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));

const schedulesResponse = {
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
};

describe("ScheduleBackupForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces list load failures instead of showing empty state", async () => {
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("调度器不可用"));

    renderWithI18n(<ScheduleBackupForm />, { locale: "zh" });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("调度器不可用"));
    expect(screen.queryByText("暂无备份计划")).not.toBeInTheDocument();
  });

  it("surfaces toggle failures instead of silently swallowing them", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce(schedulesResponse)
      .mockRejectedValueOnce(new Error("调度器不可用"));

    renderWithI18n(<ScheduleBackupForm />, { locale: "zh" });

    await user.click(await screen.findByRole("button", { name: "暂停" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("调度器不可用"));
  });

  it("names the schedule's field and offers what the button will do to each schedule", async () => {
    // The name was labelled "备份记录", and the button read "暂停/恢复" whatever the schedule's state.
    const paused = { ...schedulesResponse.schedules[0]!, id: "sched_2", name: "每周完整备份", status: "PAUSED", nextRunAt: null };
    vi.mocked(csrfFetch).mockResolvedValueOnce({ schedules: [schedulesResponse.schedules[0]!, paused] });

    renderWithI18n(<ScheduleBackupForm />, { locale: "zh" });

    expect(screen.getByLabelText("计划名称")).toHaveAttribute("id", "schedule-backup-name");
    const row = async (name: string) => (await screen.findByText(name)).closest("div.px-4") as HTMLElement;
    expect(within(await row("每日数据库备份")).getByRole("button", { name: "暂停" })).toBeEnabled();
    expect(within(await row("每周完整备份")).getByRole("button", { name: "恢复" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "暂停/恢复" })).toBeNull();
  });

  it("keeps the delete dialog open and shows an error when delete fails", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce(schedulesResponse)
      .mockRejectedValueOnce(new Error("删除失败：仍有运行中的任务"));

    renderWithI18n(<ScheduleBackupForm />, { locale: "zh" });

    await screen.findByText("每日数据库备份");
    await user.click(screen.getAllByRole("button", { name: "删除" }).at(-1)! as HTMLElement);
    const dialog = await screen.findByRole("dialog", { name: "删除备份计划" });
    await user.click(within(dialog).getByRole("button", { name: "确认删除" }));

    // In the dialog that asked, not under the form behind it.
    expect(await within(dialog).findByText("删除失败：仍有运行中的任务")).toBeVisible();
    expect(screen.getByRole("dialog", { name: "删除备份计划" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "确认删除" })).toBeEnabled();

    // Cancelled and asked again: the earlier failure is not shown for the new question.
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    await user.click(screen.getAllByRole("button", { name: "删除" }).at(-1)! as HTMLElement);
    expect(within(await screen.findByRole("dialog", { name: "删除备份计划" })).queryByText("删除失败：仍有运行中的任务")).toBeNull();
  });
});
