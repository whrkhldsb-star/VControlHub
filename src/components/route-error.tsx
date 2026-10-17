"use client";

import { unstable_isUnrecognizedActionError } from "next/navigation";
import { useEffect } from "react";

import { PermissionDenied, StatusScreen } from "@/components/page-shell";
import { AlertTriangle, RefreshCw } from "@/components/icons";
import { useI18n } from "@/lib/i18n/use-locale";
import { isForbiddenErrorLike } from "@/lib/errors";
import { createLogger } from "@/lib/logging";
import { ActionButton, ButtonLink } from "@/components/action-button";

const logger = createLogger("route-error");

// A form submitted from a tab opened before the last deploy: the server no
// longer knows that action. Reloading fixes it; it is not a fault. A plain
// boolean on purpose: Next's error class is structurally a bare Error, so the
// type guard would narrow `error` to never once this branch returns.
function isStaleDeploymentError(error: unknown): boolean {
	return unstable_isUnrecognizedActionError(error);
}

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
	const staleDeployment = isStaleDeploymentError(error);

	useEffect(() => {
		if (staleDeployment) {
			logger.info("route error boundary caught a server action from an older deployment");
			return;
		}
		// TR-030 / 56 multi-tenant (Tick 3): ForbiddenError is an expected,
		// permission-driven signal, not a defect. Log at warn for audit so
		// cron / smoke pipelines can correlate page hits with denial.
		if (isForbiddenErrorLike(error)) {
			logger.warn("route error boundary captured forbidden", {
				name: error.name,
				message: error.message,
				digest: error.digest,
			});
			return;
		}
		logger.error("route error boundary captured error", error);
	}, [error, staleDeployment]);

	// Second-line guard for `requirePagePermission()`: render the shared
	// <PermissionDenied /> surface so the user sees a consistent denial
	// state across every route, instead of a generic rose error card. In a
	// production build only the digest survives the server render, so the
	// name alone would never match there.
	if (isForbiddenErrorLike(error)) {
		return <PermissionDenied />;
	}
	if (staleDeployment) {
		return (
			<StatusScreen
				icon={<RefreshCw />}
				title={t("error.staleDeployment.title")}
				description={t("error.staleDeployment.description")}
				actions={
					<ActionButton icon={<RefreshCw />} onClick={() => window.location.reload()}>
						{t("error.staleDeployment.reload")}
					</ActionButton>
				}
			/>
		);
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
