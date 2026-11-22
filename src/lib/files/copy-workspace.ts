import { copyVersion, rollbackPublishedCopy } from "@/lib/storage/copy-rollback";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { createAgentFileClient } from "@/lib/storage/agent-file-client";
import { copyStorageFile, type StorageFileNode } from "@/lib/storage/file-content";
import { deleteBackingObject, moveBackingObject, statBackingObject } from "@/lib/storage/fs-backend";

/** A copy owns its staging file and its rollback copy until the index commits. */
export function copyWorkspace(node: StorageFileNode, target: string) {
  if (node.driver === "AGENT") {
    const client = createAgentFileClient(node.id);
    const id = randomBytes(32).toString("hex");
    const step = (action: string, source?: string) => client.copyStep(target, id, action, source);
    let publishedVersion: string | undefined;
    return {
      reference: id, localStage: "",
      stage: async (source: string) => ({ size: (await step("stage", source)).offset }),
      backup: () => step("backup"), promote: async () => { publishedVersion = (await step("promote")).version; },
      rollback: () => client.copyStep(target, id, "rollback", undefined, publishedVersion), restore: () => step("restore"),
      hasBackup: async () => (await step("has-backup")).offset === 1, dropStage: () => step("drop-stage"), dropBackup: () => step("drop-backup"),
    };
  }
  let publishedVersion: string | null = null;
  const dir = path.posix.dirname(target);
  const stage = path.posix.join(dir, `.vch-copy-${randomUUID()}`);
  const backup = path.posix.join(dir, `.vch-backup-${randomUUID()}`);
  const move = (from: string, to: string) => moveBackingObject({ storageNode: node, oldRelativePath: from, newRelativePath: to });
  const remove = (relativePath: string) => deleteBackingObject({ storageNode: node, relativePath, isDirectory: false, tolerateMissing: true });
  return {
    reference: backup, localStage: stage,
    stage: (source: string) => copyStorageFile(node, source, stage),
    backup: () => move(target, backup), promote: async () => {
      publishedVersion = await copyVersion(node, stage);
      await move(stage, target);
    }, restore: () => move(backup, target),
    hasBackup: () => statBackingObject({ storageNode: node, relativePath: backup }),
    rollback: () => rollbackPublishedCopy(node, target, publishedVersion), dropStage: () => remove(stage), dropBackup: () => remove(backup),
  };
}
