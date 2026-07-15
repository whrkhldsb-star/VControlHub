/** Pure helpers / tone maps for the health dashboard. */

export type SystemHealthStatus = "healthy" | "warning" | "critical";
export type SystemHealthSummary = {
	total: number;
	healthy: number;
	warning: number;
	critical: number;
	overall: SystemHealthStatus;
};

export type RepairSuggestion = {
	id: string;
	label: string;
	description: string;
	descriptionCritical?: string;
	descriptionWarning?: string;
	action: string;
	status: SystemHealthStatus;
	href?: string;
};

export type TFunc = (key: string) => string;

export const repairSuggestions = (
	summary: SystemHealthSummary | null | undefined,
	t: TFunc,
): RepairSuggestion[] => {
	if (!summary) return [];
	return [
		{
			id: "db",
			label: t("healthPage.repair.db.label"),
			action: t("healthPage.repair.db.action"),
			description:
				summary.critical > 0
					? t("healthPage.repair.db.descriptionCritical")
					: t("healthPage.repair.db.description"),
			status: summary.critical > 0 ? "critical" : "healthy",
		},
		{
			id: "runtime",
			label: t("healthPage.repair.runtime.label"),
			action: t("healthPage.repair.runtime.action"),
			description:
				summary.warning > 0
					? t("healthPage.repair.runtime.descriptionWarning")
					: t("healthPage.repair.runtime.description"),
			status: summary.warning > 0 ? "warning" : "healthy",
		},
		{
			id: "services",
			label: t("healthPage.repair.services.label"),
			action: t("healthPage.repair.services.action"),
			description:
				summary.critical > 0
					? t("healthPage.repair.services.descriptionCritical")
					: t("healthPage.repair.services.description"),
			status: summary.critical > 0 ? "critical" : "healthy",
		},
		{
			id: "git",
			label: t("healthPage.repair.git.label"),
			action: t("healthPage.repair.git.action"),
			description:
				summary.warning > 0
					? t("healthPage.repair.git.descriptionWarning")
					: t("healthPage.repair.git.description"),
			status: summary.warning > 0 ? "warning" : "healthy",
		},
		{
			id: "audit",
			label: t("healthPage.repair.audit.label"),
			action: t("healthPage.repair.audit.action"),
			description:
				summary.critical > 0
					? t("healthPage.repair.audit.descriptionCritical")
					: t("healthPage.repair.audit.description"),
			href: "/audit?action=command.execute",
			status: summary.critical > 0 ? "critical" : "warning",
		},
	];
};

export const repairToneClasses: Record<
	SystemHealthStatus,
	{ border: string; bg: string; badge: string }
> = {
	healthy: {
		border: "border-[var(--success-border)]",
		bg: "bg-[var(--success-bg)]",
		badge: "border-[var(--success-border)] text-[var(--success)]",
	},
	warning: {
		border: "border-[var(--warning-border)]",
		bg: "bg-[var(--warning-bg)]",
		badge: "border-[var(--warning-border)] text-[var(--warning)]",
	},
	critical: {
		border: "border-[var(--danger-border)]",
		bg: "bg-[var(--danger-bg)]",
		badge: "border-[var(--danger-border)] text-[var(--danger)]",
	},
};

export const statusToneClasses: Record<string, { bg: string; text: string; dot: string }> = {
	healthy: {
		bg: "border-[var(--success-border)] bg-[var(--success-bg)]",
		text: "text-[var(--success)]",
		dot: "bg-[var(--success)]",
	},
	warning: {
		bg: "border-[var(--warning-border)] bg-[var(--warning-bg)]",
		text: "text-[var(--warning)]",
		dot: "bg-[var(--warning)]",
	},
	critical: {
		bg: "border-[var(--danger-border)] bg-[var(--danger-bg)]",
		text: "text-[var(--danger)]",
		dot: "bg-[var(--danger)]",
	},
	offline: {
		bg: "border-[var(--border)] bg-[var(--surface)]",
		text: "text-[var(--text-secondary)]",
		dot: "bg-[var(--surface)]",
	},
	unknown: {
		bg: "border-[var(--border)] bg-[var(--surface)]",
		text: "text-[var(--text-secondary)]",
		dot: "bg-[var(--surface)]",
	},
};

export const unknownTone = statusToneClasses.unknown!;

export type HealthStatusKey = keyof typeof statusToneClasses;

export function statusLabelKey(status: string): `healthPage.status.${HealthStatusKey}` {
	return `healthPage.status.${status in statusToneClasses ? (status as HealthStatusKey) : "unknown"}`;
}

export function usageColor(val: number | undefined, warn = 80, crit = 95): string {
	if (val === undefined) return "text-[var(--text-muted)]";
	if (val >= crit) return "text-[var(--danger)]";
	if (val >= warn) return "text-[var(--warning)]";
	return "text-[var(--success)]";
}

export function usageBarColor(val: number | undefined, warn = 80, crit = 95): string {
	if (val === undefined) return "bg-[var(--surface)]";
	if (val >= crit) return "bg-[var(--danger)]";
	if (val >= warn) return "bg-[var(--warning)]";
	return "bg-[var(--success)]";
}

export function tt(
	t: TFunc,
	key: string,
	vars?: Record<string, string | number>,
): string {
	let s = t(key);
	if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
	return s;
}
