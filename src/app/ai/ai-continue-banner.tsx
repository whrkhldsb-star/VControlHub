"use client";

/**
 * The prompt under a turn whose actions settled: the assistant continues by itself after a short pause
 * (Continue now / Pause), or waits for the one-click "Continue AI response".
 */
import { ActionButton } from "@/components/action-button";
import { Loader2, Play, Sparkles } from "@/components/icons";
import { useI18n } from "@/lib/i18n/use-locale";

import { type ContinuationView, MAX_CONSECUTIVE_AUTO_CONTINUES } from "./hooks/use-ai-continuation";

export function AiContinueBanner({ view }: { view: ContinuationView }) {
	const { t } = useI18n();
	if (view.state === "hidden") return null;
	const auto = view.state === "auto";
	return (
		<div
			role="status"
			data-ai-continue={view.state}
			className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-bg)] px-3 py-2 text-xs text-[var(--text-secondary)]"
		>
			{auto ? <Loader2 size={13} aria-hidden className="shrink-0 animate-spin text-[var(--accent)]" /> : <Sparkles size={13} aria-hidden className="shrink-0 text-[var(--accent)]" />}
			<span className="min-w-0 flex-1">
				{auto
					? t("aiPage.continue.auto")
					: view.limitReached
						? t("aiPage.continue.limit", { count: MAX_CONSECUTIVE_AUTO_CONTINUES })
						: t("aiPage.continue.available")}
			</span>
			{auto ? (
				<>
					<ActionButton size="xs" variant="primary" icon={<Play size={12} aria-hidden />} onClick={view.continueNow}>
						{t("aiPage.continue.now")}
					</ActionButton>
					<ActionButton size="xs" variant="secondary" onClick={view.pause}>
						{t("aiPage.continue.pause")}
					</ActionButton>
				</>
			) : (
				<ActionButton size="xs" variant="primary" icon={<Play size={12} aria-hidden />} onClick={view.continueNow}>
					{t("aiPage.continue.button")}
				</ActionButton>
			)}
		</div>
	);
}
