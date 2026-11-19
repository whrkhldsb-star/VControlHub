import { describe, expect, it } from "vitest";
import { resolveTaskDrive } from "../destination";

describe("download destinations", () => {
  const direct = { id: "ssh-drive" }, first = { id: "agent-one" }, second = { id: "agent-two" };
  const server = () => ({ storageNode: direct, agentFileShares: [{ node: first }, { node: second }] });

  it("uses the recorded drive on mixed servers and keeps legacy downloads on their direct drive", () => {
    expect(resolveTaskDrive({ server: server(), agentStorageNodeId: second.id }).server).toEqual({ storageNode: second });
    expect(resolveTaskDrive({ server: server(), agentStorageNodeId: null }).server).toEqual({ storageNode: direct });
  });
  it("keeps a queued direct download tied to the original drive after rebinding", () => {
    expect(resolveTaskDrive({ server: server(), directStorageNodeId: direct.id }).server.storageNode).toEqual(direct);
    expect(resolveTaskDrive({ server: server(), directStorageNodeId: "retired-direct" }).server.storageNode).toBeNull();
  });

  it("keeps a detached Agent destination unavailable when another drive exists", () => {
    expect(resolveTaskDrive({ server: server(), agentStorageNodeId: "old-drive" }).server.storageNode).toBeNull();
  });
});
