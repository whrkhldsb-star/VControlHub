import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/provider";
import {
  DashboardLocalizedHeader,
  DashboardQuickLinks,
  DashboardRecentActivity,
  DashboardServerHero,
  DashboardStatsSection,
} from "../dashboard-localized-sections";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

function renderWithLocale(ui: React.ReactNode, locale: "zh" | "en" = "zh") {
  return render(<I18nProvider initialLocale={locale}>{ui}</I18nProvider>);
}

describe("localized dashboard sections", () => {
  it("renders dashboard summary sections in English when the active locale is English", () => {
    renderWithLocale(
      <>
        <DashboardLocalizedHeader username="alice" />
        <DashboardServerHero summary={{ total: 3, enabled: 2, disabled: 1, sshKey: 2, directGateway: 1 }} />
        <DashboardStatsSection
          storage={{ serverTotal: 3, serverEnabled: 2, totalNodes: 4, totalEntries: 99 }}
          queue={{
            pendingApprovals: 5,
            downloads: { running: 1, completed: 7, failed: 2 },
            unreadNotifications: 6,
            activeScheduledTasks: 4,
          }}
        />
        <DashboardQuickLinks
          pendingApprovals={5}
          downloads={{ running: 1, completed: 7, failed: 2 }}
          unreadNotifications={6}
          activeScheduledTasks={4}
        />
      </>,
      "en",
    );

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Current user: alice")).toBeInTheDocument();
    expect(screen.getByText("VPS Status Overview")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage VPS & keys →" })).toHaveAttribute("href", "/servers");
    expect(screen.getByText("Operations Queue")).toBeInTheDocument();
    expect(screen.getByText("1 running / 7 completed / 2 failed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Downloads/ })).toHaveAttribute("href", "/downloads");
    expect(screen.getByText("5 Pending Approvals")).toBeInTheDocument();
    expect(screen.queryByText("仪表盘")).not.toBeInTheDocument();
  });

  it("renders recent activity with JSON-safe server data and localized labels", () => {
    renderWithLocale(
      <DashboardRecentActivity
        recentRequests={[
          {
            id: "req-1",
            title: "Restart service",
            command: "systemctl restart demo",
            status: "PENDING_APPROVAL",
            approvalStateLabel: "Pending",
            isAssistantInitiated: true,
            requester: { username: "alice", displayName: null },
            targetCount: 2,
          },
        ]}
        recentAuditLogs={[
          {
            id: "audit-1",
            action: "LOGIN",
            severity: "INFO",
            actorType: "USER",
            actor: { username: "bob", displayName: "Bob" },
            createdAt: "2026-05-31T00:00:00.000Z",
            formattedCreatedAt: "2026/05/31 08:00:00",
          },
        ]}
      />,
      "en",
    );

    expect(screen.getByRole("heading", { name: "Recent Approvals" })).toBeInTheDocument();
    expect(screen.getByText("alice · assistant")).toBeInTheDocument();
    expect(screen.getByText("Targets 2 servers")).toBeInTheDocument();
    expect(screen.getByText("systemctl restart demo")).toBeInTheDocument();

    const auditLink = screen.getByRole("link", { name: "View all →" });
    expect(auditLink).toHaveAttribute("href", "/audit");
    const auditTime = within(screen.getByText("LOGIN").closest("div") as HTMLElement).getByText("2026/05/31 08:00:00");
    expect(auditTime).toHaveAttribute("dateTime", "2026-05-31T00:00:00.000Z");
  });
});
