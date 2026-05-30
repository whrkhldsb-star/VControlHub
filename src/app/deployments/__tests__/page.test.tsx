import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

vi.mock("@/lib/auth/require-session", () => ({
  requireSession: vi.fn().mockResolvedValue({
    userId: "u1",
    username: "admin",
    roles: ["admin"],
    permissions: ["deploy:read", "deploy:run", "deploy:export"],
    mustChangePassword: false,
  }),
}));

vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: vi.fn((_session, permission: string) => ["deploy:read", "deploy:run", "deploy:export"].includes(permission)),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/deployment/service", () => ({
  listDeploymentRuns: vi.fn().mockResolvedValue([]),
  listDeploymentTemplates: vi.fn().mockResolvedValue([
    {
      id: "tmpl1",
      name: "Docker Compose 更新",
      description: "部署服务",
      command: "cd {{project_dir}} && docker compose up -d",
      variables: ["project_dir"],
    },
  ]),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    server: {
      findMany: vi.fn().mockResolvedValue([
        { id: "srv1", name: "生产 VPS", host: "203.0.113.10", username: "root" },
      ]),
    },
  },
}));

import { csrfFetch } from "@/lib/auth/csrf-client";
import DeploymentsPage from "../page";

const csrfFetchMock = vi.mocked(csrfFetch);

describe("DeploymentsPage", () => {
  beforeEach(() => {
    csrfFetchMock.mockReset();
    csrfFetchMock.mockResolvedValue({
      export: {
        id: "exp1",
        name: "vcontrolhub-portable",
        manifest: { appName: "vcontrolhub", domain: "console.example.test" },
        files: {
          "env.production.example": "DATABASE_URL=REPLACE_WITH_DATABASE_URL",
          "deploy.sh": "npm run build",
        },
      },
    });
  });

  it("mounts the deployment export UI and creates a portable export through csrfFetch", async () => {
    const user = userEvent.setup();
    render(await DeploymentsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("迁移部署导出包")).toBeInTheDocument();
    await user.type(screen.getByLabelText("目标域名"), " Console.Example.Test ");
    await user.type(screen.getByLabelText("应用标识"), " VControlHub ");
    await user.click(screen.getByRole("button", { name: "生成导出包" }));

    await waitFor(() => expect(csrfFetchMock).toHaveBeenCalledWith(
      "/api/deploy-export",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ domain: "console.example.test", appName: "vcontrolhub" }),
      }),
    ));
    expect(await screen.findByText("vcontrolhub-portable")).toBeInTheDocument();
    expect(screen.getByText("env.production.example")).toBeInTheDocument();
    expect(screen.getByText("deploy.sh")).toBeInTheDocument();
  });
});
