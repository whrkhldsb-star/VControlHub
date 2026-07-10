import { screen, waitFor } from "@testing-library/react";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const csrfFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: csrfFetchMock }));

const { ActiveIncidentsBanner } = await import("../active-incidents-banner");

const incident = {
  id: "inc1",
  title: "数据库主库故障",
  body: "主库出现间歇性超时，正在排查",
  level: "incident",
  startsAt: "2026-06-27T00:00:00.000Z",
  expiresAt: null,
  pinned: true,
};

const maintenance = {
  id: "mnt1",
  title: "计划维护窗口",
  body: "预计 2 小时完成升级",
  level: "maintenance",
  startsAt: "2026-06-27T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
  pinned: false,
};

describe("ActiveIncidentsBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders active incident and maintenance announcements", async () => {
    csrfFetchMock.mockResolvedValue({
      announcements: [
        incident,
        maintenance,
        { ...incident, id: "info1", level: "info", title: "日常通知" },
      ],
    });

    render(<ActiveIncidentsBanner />, { locale: "en" });

    expect(await screen.findByText("数据库主库故障")).toBeInTheDocument();
    expect(await screen.findByText("计划维护窗口")).toBeInTheDocument();
    expect(screen.queryByText("日常通知")).not.toBeInTheDocument();
  });

  it("does not render when there are no active incidents", async () => {
    csrfFetchMock.mockResolvedValue({
      announcements: [{ ...incident, id: "info1", level: "info", title: "日常通知" }],
    });

    const { container } = render(<ActiveIncidentsBanner />, { locale: "en" });
    await new Promise((r) => setTimeout(r, 200));
    expect(container.innerHTML).toBe("");
  });

  it("allows dismissing individual incident cards", async () => {
    const user = userEvent.setup();
    csrfFetchMock.mockResolvedValue({ announcements: [incident, maintenance] });

    render(<ActiveIncidentsBanner />, { locale: "en" });

    expect(await screen.findByText("数据库主库故障")).toBeInTheDocument();
    expect(await screen.findByText("计划维护窗口")).toBeInTheDocument();

    const dismissBtn = screen.getByRole("button", { name: /Dismiss notification.*数据库主库故障/ });
    await user.click(dismissBtn);

    await waitFor(() => {
      expect(screen.queryByText("数据库主库故障")).not.toBeInTheDocument();
    });
    expect(screen.getByText("计划维护窗口")).toBeInTheDocument();
  });
});
