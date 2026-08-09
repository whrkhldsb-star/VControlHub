import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

vi.mock("@/app/storage/actions", () => ({
  createStorageNodeAction: vi.fn(async () => ({})),
  checkStorageNodeHealthAction: vi.fn(async () => ({})),
  updateStorageNodeAction: vi.fn(async () => ({})),
  deleteStorageNodeAction: vi.fn(async () => ({})),
}));

import { StorageNodeManager } from "../storage-node-manager";

describe("StorageNodeManager", () => {
  it("does not offer servers that already have an automatically bound storage node", () => {
    render(
      <StorageNodeManager
        nodes={[]}
        servers={[
          {
            id: "server-bound",
            name: "Bound VPS",
            host: "203.0.113.10",
            storageNodeId: "node-bound",
          },
          {
            id: "server-available",
            name: "Legacy VPS",
            host: "203.0.113.11",
            storageNodeId: null,
          },
        ]}
        canManageNodes
      />,
      { locale: "en" },
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    fireEvent.change(screen.getByLabelText("Driver"), {
      target: { value: "SFTP" },
    });

    const serverSelect = screen.getByLabelText(/Bind VPS/);
    expect(within(serverSelect).queryByRole("option", { name: /Bound VPS/ })).not.toBeInTheDocument();
    expect(within(serverSelect).getByRole("option", { name: /Legacy VPS/ })).toBeInTheDocument();
  });
});
