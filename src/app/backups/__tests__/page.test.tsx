import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-session", () => ({
  requireSession: vi.fn().mockResolvedValue({
    userId: "u1",
    username: "admin",
    roles: ["admin"],
    permissions: ["backup:read", "backup:create", "backup:restore"],
    mustChangePassword: false,
  }),
}));

vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: vi.fn((_session, permission: string) => ["backup:read", "backup:create", "backup:restore"].includes(permission)),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/server/service", () => ({
  listServerProfiles: vi.fn().mockResolvedValue([{ id: "srv_1", name: "主节点", enabled: true }]),
}));

vi.mock("@/lib/backup/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/backup/service")>("@/lib/backup/service");
  return {
    ...actual,
    listBackupRecords: vi.fn().mockResolvedValue([
      {
        id: "bak-db",
        type: "DATABASE",
        status: "COMPLETED",
        filePath: "backups/database.sql.gz",
        createdAt: new Date("2026-05-29T00:00:00.000Z"),
        fileSize: String(1024 * 1024),
        completedAt: new Date("2026-05-29T00:00:00.000Z"),
        errorMessage: null,
        note: null,
        creator: { username: "admin", displayName: "Admin" },
      },
      {
        id: "bak-files",
        type: "FILES",
        status: "COMPLETED",
        filePath: "backups/files.tar.gz",
        createdAt: new Date("2026-05-29T00:00:00.000Z"),
        fileSize: String(2 * 1024 * 1024),
        completedAt: new Date("2026-05-29T00:00:00.000Z"),
        errorMessage: null,
        note: null,
        creator: { username: "admin", displayName: "Admin" },
      },
      {
        id: "bak-full",
        type: "FULL",
        status: "COMPLETED",
        filePath: "backups/full.tar.gz",
        createdAt: new Date("2026-05-29T00:00:00.000Z"),
        fileSize: String(3 * 1024 * 1024),
        completedAt: new Date("2026-05-29T00:00:00.000Z"),
        errorMessage: null,
        note: null,
        creator: { username: "admin", displayName: "Admin" },
      },
      {
        id: "bak-pending",
        type: "DATABASE",
        status: "PENDING",
        filePath: "backups/stale.sql.gz",
        createdAt: new Date("2026-05-30T00:00:00.000Z"),
        fileSize: null,
        completedAt: null,
        errorMessage: null,
        note: "历史排队记录",
        creator: { username: "admin", displayName: "Admin" },
      },
      {
        id: "bak-failed",
        type: "DATABASE",
        status: "FAILED",
        filePath: "backups/failed.sql.gz",
        createdAt: new Date("2026-05-31T00:00:00.000Z"),
        fileSize: null,
        completedAt: null,
        errorMessage: "readonly path",
        note: "失败记录",
        creator: { username: "admin", displayName: "Admin" },
      },
    ]),
  };
});

import BackupsPage from "../page";

describe("BackupsPage", () => {
  it("shows backup commands that match each recorded backup type", async () => {
    render(await BackupsPage());

    expect(screen.getByText("创建并执行备份")).toBeInTheDocument();
    expect(screen.getByText(/创建可审计备份记录并排入 Durable Job 后台队列/)).toBeInTheDocument();
    expect(screen.queryByText(/提交后会立即在服务器执行对应的 deploy\/backup\.sh 模式/)).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("备份类型")).toHaveLength(2);
    expect(screen.getAllByLabelText("备份类型")[0]).toHaveValue("DATABASE");
    expect(screen.getByLabelText("备份备注")).toHaveAttribute("placeholder", "例如：升级前备份");
    expect(screen.getByRole("button", { name: "创建并执行" })).toBeInTheDocument();

    expect(screen.getByText("备份策略概览")).toBeInTheDocument();
    expect(screen.getByText("已用备份空间")).toBeInTheDocument();
    expect(screen.getByText("6.0 MB")).toBeInTheDocument();
    expect(screen.getByText("最大：FULL · 3.0 MB")).toBeInTheDocument();
    expect(screen.getByText("保留策略提示")).toBeInTheDocument();
    expect(screen.getByText("条完成备份超过 30 天，建议复核清理")).toBeInTheDocument();
    expect(screen.getByText("DATABASE").closest("div")).toHaveTextContent("1 个 · 1.0 MB");
    expect(screen.getByText("FILES").closest("div")).toHaveTextContent("1 个 · 2.0 MB");
    expect(screen.getByText("FULL").closest("div")).toHaveTextContent("1 个 · 3.0 MB");
    expect(screen.getByRole("heading", { name: "备份失败原因聚合" })).toBeInTheDocument();
    expect(screen.getByText(/按最近 200 条备份记录中的 FAILED 错误文本归类/)).toBeInTheDocument();
    expect(screen.getByText("失败记录：1")).toBeInTheDocument();
    expect(screen.getByText("权限或只读路径")).toBeInTheDocument();
    expect(screen.getByText("最新记录：backups/failed.sql.gz")).toBeInTheDocument();
    expect(screen.getByText("readonly path")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "创建定时备份" })).toBeInTheDocument();
    expect(screen.getByText(/选择备份类型、Cron 与执行节点后/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建定时备份" })).toBeInTheDocument();
    expect(screen.getByText("主节点")).toBeInTheDocument();

    expect(screen.getByText(/deploy\/backup\.sh 'backups\/database\.sql\.gz'/)).toBeInTheDocument();
    expect(screen.getByText(/deploy\/backup\.sh --files 'backups\/files\.tar\.gz'/)).toBeInTheDocument();
    expect(screen.getByText(/deploy\/backup\.sh --full 'backups\/full\.tar\.gz'/)).toBeInTheDocument();
    expect(screen.getByText(/restore-db\.sh 'backups\/database\.sql\.gz'/)).toBeInTheDocument();
    expect(screen.getByText(/tar -xzf 'backups\/files\.tar\.gz'/)).toBeInTheDocument();
    expect(screen.getByText(/tar -xzf 'backups\/full\.tar\.gz'/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "执行恢复" })).toHaveLength(5);
    expect(screen.getAllByRole("button", { name: "标记作废" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "重试备份" })).toBeInTheDocument();
    expect(screen.getAllByText("对历史 PENDING/FAILED 记录写入作废说明，不删除备份审计记录。")).toHaveLength(2);
  });
});
