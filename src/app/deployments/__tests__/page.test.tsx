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

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined),
  }),
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
import { prisma } from "@/lib/db";
import DeploymentsPage from "../page";

const csrfFetchMock = vi.mocked(csrfFetch);
const serverFindManyMock = vi.mocked(prisma.server.findMany);

const sampleExport = {
  export: {
    id: "exp-uuid-1",
    name: "vcontrolhub-portable",
    manifest: { appName: "vcontrolhub", domain: "console.example.test" },
    files: {
      "env.production.example": 'DATABASE_URL="REPLACE_WITH_DATABASE_URL"\n',
      "deploy.sh": "npm run build\n",
      "Caddyfile.example": "example.com { reverse_proxy 127.0.0.1:3000 }\n",
    },
  },
};

describe("DeploymentsPage deploy-export panel", () => {
  beforeEach(() => {
    csrfFetchMock.mockReset();
    csrfFetchMock.mockResolvedValue(sampleExport);
  });

  it("renders the panel, generates a portable export, and shows the ZIP download + tree preview", async () => {
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

    // The new UI: ZIP download button is present, JSON download button is gone.
    expect(screen.getByTestId("deploy-export-zip")).toHaveTextContent("一键导出 ZIP");
    expect(screen.queryByRole("button", { name: "下载 JSON" })).toBeNull();

    // The tree view exposes the three generated files.
    expect(screen.getByTestId("deploy-export-tree")).toBeInTheDocument();
    expect(screen.getByTestId("deploy-export-file-env.production.example")).toBeInTheDocument();
    expect(screen.getByTestId("deploy-export-file-deploy.sh")).toBeInTheDocument();
    expect(screen.getByTestId("deploy-export-file-Caddyfile.example")).toBeInTheDocument();

    // The preview pane shows a per-file rollback select plus the active file content.
    // The panel picks the first alphabetical file by default — `Caddyfile.example`.
    expect(screen.getByTestId("deploy-export-file-select")).toBeInTheDocument();
    expect(screen.getByTestId("deploy-export-rollback")).toBeInTheDocument();
    expect(screen.getByTestId("deploy-export-download-active")).toBeInTheDocument();
    expect(screen.getByTestId("deploy-export-preview")).toHaveTextContent(
      /reverse_proxy 127\.0\.0\.1:3000/,
    );
  });

  it("bounds enabled target server hydration for the deployment form", async () => {
    render(await DeploymentsPage({ searchParams: Promise.resolve({}) }));

    expect(serverFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { enabled: true },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, name: true, host: true, username: true },
    }));
  });
});
