"use client";

import { CommandLaunchForm } from "./command-launch-form";
import { BatchServerActionPanel } from "./batch-server-action-panel";

export function ServerOperationPanel({ kind, allowDirectExecution = false }: { kind: "command" | "batch"; allowDirectExecution?: boolean }) {
  return kind === "batch" ? <BatchServerActionPanel servers={[]} enabledCount={0} remoteTargets />
    : <CommandLaunchForm servers={[]} allowDirectExecution={allowDirectExecution} remoteTargets />;
}
