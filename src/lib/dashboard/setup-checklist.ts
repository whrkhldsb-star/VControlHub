/**
 * Pure helpers for the dashboard "first setup" checklist.
 * Kept free of React/Prisma so unit tests can cover decision logic.
 */
import type { Permission } from "@/lib/auth/rbac";


export type SetupChecklistItemId =
	| "servers"
	| "alertRules"
	| "notificationOutbound"
	| "backupSchedule"
	| "costMonthly";

export type SetupChecklistItem = {
	id: SetupChecklistItemId;
	done: boolean;
	href: string;
	/** Permission needed to complete the item; accounts without it never see it. */
	permission: Permission;
};

export type SetupChecklistInput = {
	serverCount: number;
	enabledAlertRuleCount: number;
	/** SMTP outbound enabled (settings smtp.enabled === "true"). */
	smtpEnabled: boolean;
	/** Project and/or VPS backup schedules present. */
	backupScheduleCount: number;
	/** Servers with a positive monthly cost filled in. */
	serversWithMonthlyCost: number;
};

/**
 * Build checklist rows. Callers decide whether to show the panel
 * (typically when `pendingCount > 0`).
 */
export function buildSetupChecklist(input: SetupChecklistInput): SetupChecklistItem[] {
	return [
		{
			id: "servers",
			done: input.serverCount > 0,
			href: "/servers",
			permission: "server:write",
		},
		{
			id: "alertRules",
			done: input.enabledAlertRuleCount > 0,
			href: "/alert-rules",
			permission: "notification:manage",
		},
		{
			id: "notificationOutbound",
			done: input.smtpEnabled,
			href: "/settings",
			permission: "user:manage",
		},
		{
			id: "backupSchedule",
			done: input.backupScheduleCount > 0,
			href: "/backups",
			permission: "backup:read",
		},
		{
			id: "costMonthly",
			// Only meaningful once at least one server exists.
			done: input.serverCount === 0 ? false : input.serversWithMonthlyCost > 0,
			href: "/servers",
			permission: "server:write",
		},
	];
}

/** The rows an account can act on: a customer viewer gets no checklist at all. */
export function filterSetupChecklist(items: SetupChecklistItem[], can: (permission: Permission) => boolean): SetupChecklistItem[] {
	return items.filter((item) => can(item.permission));
}

export function countPendingSetupItems(items: SetupChecklistItem[]): number {
	return items.filter((item) => !item.done).length;
}
