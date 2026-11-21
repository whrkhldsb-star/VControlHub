import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ servers: vi.fn(), readable: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { server: { findMany: mocks.servers } } }));
vi.mock("@/lib/server/inventory", () => ({ readableBoundDriveIds: mocks.readable }));
vi.mock("@/lib/auth/page-guard", () => ({ requirePagePermission: async () => ({ userId: "u", roles: ["viewer"], currentTeamId: "a", permissions: ["storage:read"] }) }));
vi.mock("@/app/downloads/downloads-client", () => ({ DownloadsClient: ({ servers }: { servers: unknown }) => <pre data-testid="targets">{JSON.stringify(servers)}</pre> }));
import DownloadsPage from "@/app/downloads/page";

it("only hydrates readable same-team drives and keeps remote connection details out of the client", async () => {
  const node = { id: "readable", teamId: "a", driver: "SFTP", name: "Data", basePath: "/private-root", host: "private-host", port: 2022, directAccessMode: "PROXY" };
  mocks.servers.mockResolvedValue([{ id: "srv", teamId: "a", managementMode: "AGENT", name: "Server", host: "hidden-host", storageNode: node,
    agentFileShares: [{ teamId: "a", node: { ...node, id: "denied" } }, { teamId: "a", node: { ...node, id: "moved", teamId: "b" } }] }]);
  mocks.readable.mockResolvedValue(new Set(["readable", "moved"]));
  render(await DownloadsPage());
  const targets = screen.getByTestId("targets").textContent;
  expect(JSON.parse(targets!)).toMatchObject([{ serverId: "srv", storageNodeId: "readable", storagePath: "", host: "" }]);
  expect(targets).not.toMatch(/denied|moved|private-root|private-host|hidden-host|2022/);
});
