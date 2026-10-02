"use client";

/**
 * TR-007 M03: 异地备份 dry-run 按钮 — 调 /api/backups/offsite/dry-run,
 * 显示结果 (ok/disabled/config_invalid/s3_error)。
 */
import { useState, useTransition } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { Notice } from "@/components/ui-primitives";

type DryRunState =
	| { kind: "idle" }
	| { kind: "running" }
	| { kind: "ok"; latencyMs: number; probeKey: string }
	| { kind: "disabled" }
	| { kind: "config_invalid"; issues: string[] }
	| { kind: "s3_error"; code: string; message: string; status: number }
	| { kind: "error"; message: string };

export function OffsiteDryRunButton() {
	const { t } = useI18n();
	const [state, setState] = useState<DryRunState>({ kind: "idle" });
	const [pending, startTransition] = useTransition();

	const run = () => {
		setState({ kind: "running" });
		startTransition(async () => {
			try {
				const res = await csrfFetch<Response>("/api/backups/offsite/dry-run", {
					method: "POST",
					raw: true,
				});
				if (res.status === 422) {
					const body = (await res.json()) as { reason?: string; issues?: string[] };
					if (body.reason === "offsite_disabled") {
						setState({ kind: "disabled" });
					} else if (body.reason === "config_invalid") {
						setState({ kind: "config_invalid", issues: body.issues ?? [] });
					} else {
						setState({ kind: "error", message: `unknown 422: ${JSON.stringify(body)}` });
					}
					return;
				}
				if (res.status === 502) {
					const body = (await res.json()) as { code?: string; message?: string; status?: number };
					setState({
						kind: "s3_error",
						code: body.code ?? "Unknown",
						message: body.message ?? "(no message)",
						status: body.status ?? 0,
					});
					return;
				}
				if (!res.ok) {
					setState({ kind: "error", message: `HTTP ${res.status}` });
					return;
				}
				const body = (await res.json()) as { probeKey?: string; latencyMs?: number };
				setState({ kind: "ok", latencyMs: body.latencyMs ?? 0, probeKey: body.probeKey ?? "" });
			} catch (err) {
				setState({ kind: "error", message: getErrorMessage(err, String(err)) });
			}
		});
	};

	const isRunning = pending || state.kind === "running";

	return (
		<div className="flex flex-col gap-2" data-component="offsite-dry-run">
			<ActionButton size="sm" variant="outline"
				onClick={run}
				disabled={isRunning}
				data-action="offsite-dry-run">
				{isRunning ? t("backupsPage.offsite.dryRunning") : t("backupsPage.offsite.dryRunButton")}
			</ActionButton>
			<StateView state={state} t={t} />
		</div>
	);
}

function StateView({
	state,
	t,
}: {
	state: DryRunState;
	t: (key: string, vars?: Record<string, string | number>) => string;
}) {
	if (state.kind === "idle") return null;
	if (state.kind === "running") {
		return <p className="text-xs text-[var(--text-muted)]">{t("backupsPage.offsite.dryRunning")}</p>;
	}
	if (state.kind === "ok") {
		return (
			<Notice tone="success" compact>
				{t("backupsPage.offsite.dryRunOk", { latencyMs: state.latencyMs })}
			</Notice>
		);
	}
	if (state.kind === "disabled") {
		return (
			<Notice tone="warning" compact>
				{t("backupsPage.offsite.dryRunDisabled")}
			</Notice>
		);
	}
	if (state.kind === "config_invalid") {
		return (
			<Notice tone="warning" compact title={t("backupsPage.offsite.dryRunConfigInvalid")}>
				<ul className="list-disc pl-4">
					{state.issues.map((issue) => (
						<li key={issue}>{issue}</li>
					))}
				</ul>
			</Notice>
		);
	}
	if (state.kind === "s3_error") {
		return (
			<Notice tone="danger" compact>
				{t("backupsPage.offsite.dryRunFailed", { message: `[${state.code} / HTTP ${state.status}] ${state.message}` })}
			</Notice>
		);
	}
	return (
		<Notice tone="danger" compact>
			{t("backupsPage.offsite.dryRunFailed", { message: state.message })}
		</Notice>
	);
}
