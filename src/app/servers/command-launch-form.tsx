"use client";

import { DirectCommandComposer, type ComposerProps } from "@/app/commands/direct-command-composer";
import { useSessionGate } from "@/lib/auth/session-context";

export type { CommandTargetOption } from "@/app/commands/direct-command-composer";

export function CommandLaunchForm(props: ComposerProps) {
	const { permissions } = useSessionGate();
	return <DirectCommandComposer canReadRequests={permissions.includes("command:read")} canReadTasks={permissions.includes("task:read")}
		canReadSavedSnippets={permissions.includes("snippet:manage")} {...props} />;
}
