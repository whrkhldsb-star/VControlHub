import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuditLogClient } from "../audit-client";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

const auditResponse = {
  logs: [
    {
      id: "audit_1",
      actorType: "USER",
      actorId: "user_1",
      action: "server.delete",
      severity: "WARNING",
      detail: { serverId: "srv_1", name: "生产节点" },
      createdAt: "2026-01-01T00:00:00.000Z",
      actor: { username: "admin", displayName: "管理员" },
    },
  ],
  total: 1,
  page: 1,
  pageSize: 50,
  totalPages: 1,
};

describe("AuditLogClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces audit log load failures instead of showing an empty audit trail", async () => {
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("审计数据库暂时不可用"));

    render(<AuditLogClient />);

    expect(await screen.findByRole("alert")).toHaveTextContent("审计数据库暂时不可用");
    expect(screen.queryByText("暂无审计日志。")).not.toBeInTheDocument();
  });

  it("keeps existing audit rows visible when refresh fails", async () => {
    const actor = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce(auditResponse)
      .mockRejectedValueOnce(new Error("刷新审计日志失败"));

    render(<AuditLogClient />);

    expect(await screen.findByText("删除节点")).toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "↻ 刷新" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("刷新审计日志失败");
    expect(screen.getAllByText("删除节点").length).toBeGreaterThan(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "↻ 刷新" })).toBeEnabled());
  });
});
