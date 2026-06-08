import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateFolderForm } from "../create-folder-form";

const refreshMock = vi.hoisted(() => vi.fn());
const createFolderActionMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("../../storage/actions", () => ({
  createFolderAction: (...args: unknown[]) => createFolderActionMock(...args),
}));

const nodes = [
  { id: "node_local", name: "本机存储", driver: "LOCAL" },
  { id: "node_sftp", name: "香港 VPS", driver: "SFTP" },
];

describe("CreateFolderForm", () => {
  beforeEach(() => {
    refreshMock.mockClear();
    createFolderActionMock.mockReset();
    createFolderActionMock.mockResolvedValue({ success: "文件夹已创建" });
  });

  it("defaults to the current storage node when creating a folder", async () => {
    const user = userEvent.setup();
    render(
      <CreateFolderForm
        storageNodes={nodes}
        currentPath="docs"
        initialNodeId="node_sftp"
      />,
    );

    await user.click(screen.getByRole("button", { name: "新建文件夹" }));

    expect(screen.getByText("目标节点")).toBeVisible();
    expect(screen.getByText("文件夹名称")).toBeVisible();
    expect(screen.getByLabelText("目标节点")).toHaveValue("node_sftp");
  });

  it("refreshes SPA data after the server action succeeds", async () => {
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(
      <CreateFolderForm
        storageNodes={nodes}
        currentPath="docs"
        initialNodeId="node_sftp"
        onCreated={onCreated}
      />,
    );

    await user.click(screen.getByRole("button", { name: "新建文件夹" }));
    await user.type(screen.getByLabelText("文件夹名称"), "reports");
    await user.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(refreshMock).toHaveBeenCalled();
  });
});
