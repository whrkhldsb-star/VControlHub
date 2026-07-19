"use client";

/**
 * TR-007 M03: 异地备份 dry-run 按钮 — 调 /api/backups/offsite/dry-run,
 * 显示结果 (ok/disabled/config_invalid/s3_error)。
 */
import { useState, useTransition } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { t } from "@/lib/i18n/translations";

type DryRunState =
	| { kind: "idle" }
	| { kind: "running" }
	| { kind: "ok"; latencyMs: number; probeKey: string }
	| { kind: "disabled" }
	| { kind: "config_invalid"; issues: string[] }
	| { kind: "s3_error"; code: string; message: string; status: number }
	| { kind: "error"; message: string };

export function OffsiteDryRunButton() {
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
				setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
			}
		});
	};

	const isRunning = pending || state.kind === "running";

	return (
		<div className="flex flex-col gap-2" data-component="offsite-dry-run">
			<button
				type="button"
				onClick={run}
				disabled={isRunning}
				data-action="offsite-dry-run"
				data-action-button
				data-variant="outline"
				className="!px-3 !py-1.5 !text-xs !font-medium disabled:cursor-not-allowed disabled:opacity-50"
			>
				{isRunning ? t("backupsPage.offsite.dryRunning") : t("backupsPage.offsite.dryRunButton")}
			</button>
			<StateView state={state} />
		</div>
	);
}

function StateView({ state }: { state: DryRunState }) {
	if (state.kind === "idle") return null;
	if (state.kind === "running") {
		return <p className="text-xs text-[var(--text-muted)]">{t("backupsPage.offsite.dryRunning")}</p>;
	}
	if (state.kind === "ok") {
		return (
			<p
				data-tone="emerald"
				className="rounded-lg border border-[var(--success-border)] px-2 py-1.5 text-xs text-[var(--success)]"
			>
				{t("backupsPage.offsite.dryRunOk").replace("{latencyMs}", String(state.latencyMs))}
			</p>
		);
	}
	if (state.kind === "disabled") {
		return (
			<p
				data-tone="amber"
				className="rounded-lg border border-[var(--warning-border)] px-2 py-1.5 text-xs text-[var(--warning)]"
			>
				{t("backupsPage.offsite.dryRunDisabled")}
			</p>
		);
	}
	if (state.kind === "config_invalid") {
		return (
			<div
				data-tone="amber"
				className="rounded-lg border border-[var(--warning-border)] px-2 py-1.5 text-xs text-[var(--warning)]"
			>
				<p className="font-medium">{t("backupsPage.offsite.dryRunConfigInvalid")}</p>
				<ul className="mt-1 list-disc pl-4">
					{state.issues.map((issue) => (
						<li key={issue}>{issue}</li>
					))}
				</ul>
			</div>
		);
	}
	if (state.kind === "s3_error") {
		return (
			<p
				data-tone="rose"
				className="rounded-lg border border-[var(--danger-border)] px-2 py-1.5 text-xs text-[var(--danger)]"
			>
				{t("backupsPage.offsite.dryRunFailed")
					.replace("{message}", `[${state.code} / HTTP ${state.status}] ${state.message}`)}
			</p>
		);
	}
	return (
		<p
			data-tone="rose"
			className="rounded-lg border border-[var(--danger-border)] px-2 py-1.5 text-xs text-[var(--danger)]"
		>
			{t("backupsPage.offsite.dryRunFailed").replace("{message}", state.message)}
		</p>
	);
}
