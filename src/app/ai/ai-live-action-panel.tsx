"use client";

/**
 * A hosted action the page follows after it left its confirmation card: running now (live target status, exit
 * code, masked output, and Cancel while it runs), filed for another reviewer (a receipt that says it has not
 * run, with the link to its request), or final.
 */
import { ActionButton, ButtonLink } from "@/components/action-button";
import { Check, Clock, Loader2, X } from "@/components/icons";
import { Badge } from "@/components/ui-primitives";
import { getDomainStatusLabel } from "@/lib/i18n/domain-labels";
import { useI18n } from "@/lib/i18n/use-locale";
import { commandRequestHref } from "@/lib/ui/deep-links";
import { cn } from "@/lib/ui/cn";

import { useLabel } from "./ai-tool-approval-card";
import type { TrackedAction } from "./hooks/use-hosted-action-tracker";

const OUTPUT_TAIL_CHARS = 4_000;

function tail(text: string | null | undefined): string {
	if (!text) return "";
	return text.length > OUTPUT_TAIL_CHARS ? `…${text.slice(-OUTPUT_TAIL_CHARS)}` : text;
}

export function AiLiveActionPanel({
	action,
	canCancel,
	onCancel,
	compact = false,
}: {
	action: TrackedAction;
	/** The account may stop (or withdraw) the command; the server decides in the end. */
	canCancel: boolean;
	onCancel: (actionId: string) => void;
	/** Inside the streaming timeline: no command line, smaller output boxes. */
	compact?: boolean;
}) {
	const { t } = useI18n();
	const label = useLabel();
	const command = action.live?.command ?? null;
	const requestId = action.commandRequestId ?? command?.id ?? null;
	const decisionSource = command?.decisionSource ?? action.live?.action.decisionSource ?? null;
	const cancelBusy = action.cancel === "pending";
	const cancelRequested = action.cancel === "requested" || command?.status === "CANCELLING";

	if (action.phase === "review") {
		return (
			<div
				role="status"
				data-live-action="review"
				className="mt-1.5 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-bg)] p-2.5 text-xs"
			>
				<div className="flex items-center gap-1.5 font-medium text-[var(--accent)]">
					<Clock size={13} aria-hidden />
					{t("aiPage.live.reviewTitle")}
				</div>
				<p className="mt-1 text-[var(--text-secondary)]">{t("aiPage.live.reviewBody")}</p>
				<div className="mt-2 flex flex-wrap items-center gap-2">
					{requestId ? (
						<ButtonLink href={commandRequestHref(requestId)} size="xs" variant="secondary">
							{t("aiPage.live.openRequest")}
						</ButtonLink>
					) : null}
					{canCancel && requestId ? (
						<ActionButton size="xs" variant="danger" loading={cancelBusy} disabled={cancelRequested} onClick={() => onCancel(action.actionId)}>
							{t("aiPage.live.withdraw")}
						</ActionButton>
					) : null}
				</div>
			</div>
		);
	}

	const running = action.phase === "running";
	const status = action.status;
	const failed = status === "FAILED" || status === "REJECTED";
	const statusLabel = running ? t("aiPage.live.status.running") : label(`aiPage.live.status.${status ?? ""}`, status ?? "");
	const targets = command?.targets ?? [];

	return (
		<section
			aria-label={t("aiPage.live.ariaLabel")}
			data-live-action={running ? "running" : status ?? "settled"}
			className={cn(
				"mt-1.5 rounded-lg border p-2.5 text-xs",
				running
					? "border-[var(--accent-border)] bg-[color-mix(in_srgb,var(--accent-bg)_60%,var(--surface))]"
					: failed
						? "border-[var(--danger-border)] bg-[var(--danger-bg)]"
						: status === "COMPLETED"
							? "border-[var(--success-border)] bg-[color-mix(in_srgb,var(--success-bg)_60%,var(--surface))]"
							: "border-[var(--border)] bg-[var(--surface-subtle)]",
			)}
		>
			<div className="flex flex-wrap items-center gap-2">
				<span role="status" className={cn("inline-flex items-center gap-1.5 font-medium", running ? "text-[var(--accent)]" : failed ? "text-[var(--danger)]" : status === "COMPLETED" ? "text-[var(--success)]" : "text-[var(--text-secondary)]")}>
					{running ? <Loader2 size={13} aria-hidden className="animate-spin" /> : failed || status === "CANCELLED" ? <X size={13} aria-hidden /> : <Check size={13} aria-hidden />}
					{statusLabel}
				</span>
				{decisionSource ? (
					<Badge tone="neutral">{label(`requestsPage.decisionSource.${decisionSource}`, decisionSource)}</Badge>
				) : null}
				<span className="ml-auto flex flex-wrap items-center gap-2">
					{running && canCancel && requestId ? (
						<ActionButton size="xs" variant="danger" loading={cancelBusy} disabled={cancelRequested} onClick={() => onCancel(action.actionId)}>
							{cancelRequested ? t("aiPage.live.cancelling") : t("aiPage.live.cancel")}
						</ActionButton>
					) : null}
					{requestId && !compact ? (
						<ButtonLink href={commandRequestHref(requestId)} size="xs" variant="ghost">
							{t("aiPage.live.openRequest")}
						</ButtonLink>
					) : null}
				</span>
			</div>
			{!compact && command?.command ? (
				<pre data-inset="" className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-all p-2 font-mono text-[11px] text-[var(--text-primary)]">{command.command}</pre>
			) : null}
			{cancelRequested && running ? <p className="mt-1.5 text-[var(--warning)]">{t("aiPage.live.cancelRequested")}</p> : null}
			{action.pollFailed && running ? <p className="mt-1.5 text-[var(--warning)]">{t("aiPage.live.pollFailed")}</p> : null}
			{targets.length > 0 ? (
				<ul className="mt-2 space-y-2">
					{targets.map((target) => {
						const stdout = tail(target.stdout);
						const stderr = tail(target.stderr);
						return (
							<li key={target.id} data-live-target={target.status}>
								<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[var(--text-secondary)]">
									<span className="font-medium text-[var(--text-primary)]">{target.serverName ?? target.serverId}</span>
									<span>{getDomainStatusLabel((key) => t(key), target.status)}</span>
									{typeof target.exitCode === "number" ? <span className="font-mono">{t("aiPage.live.exitCode", { code: target.exitCode })}</span> : null}
									{target.outcomeUnknown ? <Badge tone="warning">{t("aiPage.live.outcomeUnknown")}</Badge> : null}
								</div>
								{stdout || stderr ? (
									<div className="mt-1 space-y-1">
										{stdout ? (
											<div>
												<p className="text-[11px] font-medium text-[var(--text-muted)]">{t("aiPage.live.stdout")}</p>
												<pre data-inset="" className={cn("overflow-auto whitespace-pre-wrap break-all p-2 font-mono text-[11px] text-[var(--text-primary)]", compact ? "max-h-28" : "max-h-48")}>{stdout}</pre>
											</div>
										) : null}
										{stderr ? (
											<div>
												<p className="text-[11px] font-medium text-[var(--text-muted)]">{t("aiPage.live.stderr")}</p>
												<pre data-inset="" className={cn("overflow-auto whitespace-pre-wrap break-all p-2 font-mono text-[11px] text-[var(--danger)]", compact ? "max-h-24" : "max-h-32")}>{stderr}</pre>
											</div>
										) : null}
									</div>
								) : running ? (
									<p className="mt-1 text-[var(--text-muted)]">{t("aiPage.live.noOutput")}</p>
								) : null}
							</li>
						);
					})}
				</ul>
			) : running ? (
				<p className="mt-1.5 text-[var(--text-muted)]">{t("aiPage.live.noOutput")}</p>
			) : null}
		</section>
	);
}
