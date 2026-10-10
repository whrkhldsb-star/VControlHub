"use client";

import { useEffect } from "react";

import { PermissionDenied, StatusScreen } from "@/components/page-shell";
import { AlertTriangle, RefreshCw } from "@/components/icons";
import { useI18n } from "@/lib/i18n/use-locale";
import { createLogger } from "@/lib/logging";
import { ActionButton, ButtonLink } from "@/components/action-button";

const logger = createLogger("route-error");

type RouteErrorProps = {
	error: Error & { digest?: string };
	reset: () => void;
	title?: string;
	description?: string;
};

export function RouteError({
	error,
	reset,
	title,
	description,
}: RouteErrorProps) {
	const { t } = useI18n();

	useEffect(() => {
		// TR-030 / 56 multi-tenant (Tick 3): ForbiddenError is an expected,
		// permission-driven signal, not a defect. Log at warn for audit so
		// cron / smoke pipelines can correlate page hits with denial.
		if (error.name === "ForbiddenError") {
			logger.warn("route error boundary captured forbidden", {
				name: error.name,
				message: error.message,
				digest: error.digest,
			});
			return;
		}
		logger.error("route error boundary captured error", error);
	}, [error]);

	// Second-line guard for `requirePagePermission()`: render the shared
	// <PermissionDenied /> surface so the user sees a consistent denial
	// state across every route, instead of a generic rose error card.
	if (error.name === "ForbiddenError") {
		return <PermissionDenied />;
	}

	const resolvedTitle = title ?? t("error.title");
	const resolvedDescription = description ?? t("error.routeDescription");
	return (
		<StatusScreen
			tone="danger"
			icon={<AlertTriangle />}
			title={resolvedTitle}
			description={error.message || resolvedDescription}
			details={
				error.digest ? (
					<p className="ui-mono inline-flex rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1 text-xs text-[var(--text-muted)]">
						{t("error.digest-label")} {error.digest}
					</p>
				) : null
			}
			actions={
				<>
					<ActionButton icon={<RefreshCw />} onClick={reset}>
						{t("common.retry")}
					</ActionButton>
					<ActionButton variant="secondary" onClick={() => window.location.reload()}>
						{t("error.hard-refresh")}
					</ActionButton>
					<ButtonLink href="/health" variant="ghost">
						{t("error.health-check")}
					</ButtonLink>
				</>
			}
		/>
	);
}
