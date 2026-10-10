/** Pure helpers / tone maps for the health dashboard. */

import type { SystemHealthReport, SystemHealthStatus, SystemHealthSummary } from "./health-types";
import type { BadgeTone } from "@/components/ui-primitives";

export type { SystemHealthStatus, SystemHealthSummary };

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

export type TFunc = (key: string, vars?: Record<string, string | number>) => string;

type AdviceDefinition = {
	id: string;
	/** Translation key of the problem description shown when the advice applies. */
	issueKey: string;
	href?: string;
	covers: (checkId: string) => boolean;
};

/** Each piece of advice answers specific self-checks, never the global totals. */
const ADVICE: AdviceDefinition[] = [
	{ id: "db", issueKey: "descriptionCritical", covers: (id) => id === "database" || id === "env-database-url" },
	{ id: "services", issueKey: "descriptionCritical", covers: (id) => id.endsWith("-service") },
	{ id: "runtime", issueKey: "descriptionWarning", covers: (id) => id === "runtime-directories" || id.startsWith("dir-") },
	{ id: "inventory", issueKey: "description", href: "/servers", covers: (id) => id === "server-inventory" || id === "storage-inventory" },
	{ id: "notifications", issueKey: "description", href: "/settings#smtp", covers: (id) => id === "notification-settings" },
	{ id: "git", issueKey: "descriptionWarning", covers: (id) => id === "git-sync" },
];

/** Advice for the checks that are not healthy, worst first; empty when all pass. */
export const repairSuggestions = (
	report: SystemHealthReport | null | undefined,
	t: TFunc,
): RepairSuggestion[] => {
	if (!report) return [];
	const suggestions = ADVICE.flatMap((advice): RepairSuggestion[] => {
		const failing = report.checks.filter((check) => check.status !== "healthy" && advice.covers(check.id));
		if (failing.length === 0) return [];
		return [{
			id: advice.id,
			label: t(`healthPage.repair.${advice.id}.label`),
			description: t(`healthPage.repair.${advice.id}.${advice.issueKey}`),
			action: t(`healthPage.repair.${advice.id}.action`),
			status: failing.some((check) => check.status === "critical") ? "critical" : "warning",
			href: advice.href,
		}];
	});
	return suggestions.sort((a, b) => Number(b.status === "critical") - Number(a.status === "critical"));
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

/** Maps a health status to the shared StatusBadge tone (offline/unknown/other → neutral). */
export function healthStatusBadgeTone(status: string): "success" | "warning" | "danger" | "neutral" {
	switch (status) {
		case "healthy":
			return "success";
		case "warning":
			return "warning";
		case "critical":
			return "danger";
		default:
			return "neutral";
	}
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

/** Tone equivalent of usageBarColor, for the shared ProgressBar primitive.
 *  undefined → "neutral" (rendered at 0 width, so never visible). */
export function usageBarTone(val: number | undefined, warn = 80, crit = 95): BadgeTone {
	if (val === undefined) return "neutral";
	if (val >= crit) return "danger";
	if (val >= warn) return "warning";
	return "success";
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
