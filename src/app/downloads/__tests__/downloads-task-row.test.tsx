import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DownloadTaskRow } from "../downloads-task-row";
import type { DownloadTask } from "../downloads-shared";

const task: DownloadTask = {
  id: "task_1",
  url: "https://example.com/app.zip",
  serverId: "server_1",
  targetPath: "/srv/cloud/releases/2026 Q3",
  fileName: "app.zip",
  status: "COMPLETED",
  progress: null,
  pid: null,
  errorMessage: null,
  relayMode: false,
  createdAt: "2026-07-14T10:00:00.000Z",
  updatedAt: "2026-07-14T10:00:00.000Z",
  aria2Gid: null,
  category: null,
  maxSpeedKb: null,
  totalBytes: null,
  completedBytes: null,
  downloadSpeed: null,
  fileSize: null,
  isBatch: false,
  batchUrls: null,
  downloadAccess: null,
  server: {
    id: "server_1",
    name: "Tokyo",
    host: "203.0.113.10",
    storageNode: { id: "node_1", basePath: "/srv/cloud" },
  },
  creator: null,
};

describe("DownloadTaskRow file-manager link", () => {
  it("opens the completed task target directory on its mapped storage node", () => {
    render(<DownloadTaskRow
      task={task}
      t={(key) => key === "downloadsPage.action.openFolder" ? "打开文件夹" : key}
      canManage={false}
      busyActions={{}}
      downloadingIds={{}}
      onAction={vi.fn()}
      onDownloadClick={() => vi.fn()}
      onPendingPurge={vi.fn()}
    />);

    expect(screen.getByRole("link", { name: "打开文件夹" })).toHaveAttribute(
      "href",
      "/files?nodeId=node_1&path=releases%2F2026%20Q3",
    );
  });
});
