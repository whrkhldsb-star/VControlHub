"use client";

/**
 * The composer's AI working mode switcher: Plan / Confirm / Auto / Full auto.
 *
 * A mode beyond the platform ceiling or the account's permissions stays visible with a lock and says why
 * (tooltip, and the hint line on focus or hover) instead of disappearing. When the mode in effect is lower than
 * the one chosen (a lowered ceiling, a revoked permission, an ended Full auto window) a badge says so.
 * Shift+Tab in the composer cycles through the permitted modes (see AiInputArea).
 */
import { useId, useState } from "react";

import { Badge } from "@/components/ui-primitives";
import { Zap } from "@/components/icons";
import { useI18n } from "@/lib/i18n/use-locale";
import { cn } from "@/lib/ui/cn";

import {
	type AiCapabilities,
	AUTOMATION_MODES,
	type AutomationMode,
	type EffectiveMode,
	permittedModes,
} from "./ai-automation-mode";
import { modeLockMessage } from "./hooks/use-automation-mode";

export function LockGlyph({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
			<rect x="4" y="11" width="16" height="10" rx="2" />
			<path d="M8 11V7a4 4 0 0 1 8 0v4" />
		</svg>
	);
}

/** The hint that explains a mode, with the critical-command rule of this platform. */
export function modeHint(t: (key: string) => string, mode: AutomationMode, caps: AiCapabilities): string {
	if (mode === "FULL_AUTO" && caps.fullAutoAllowCritical) return t("aiPage.mode.FULL_AUTO.hintCritical");
	return t(`aiPage.mode.${mode}.hint`);
}

export function AiModeSwitcher({
	capabilities,
	requested,
	effective,
	hostingEnabled,
	busy = false,
	onRequestMode,
	className,
	showShortcutHint = true,
}: {
	capabilities: AiCapabilities;
	requested: AutomationMode;
	effective: EffectiveMode;
	hostingEnabled: boolean;
	busy?: boolean;
	onRequestMode: (mode: AutomationMode) => void;
	className?: string;
	showShortcutHint?: boolean;
}) {
	const { t } = useI18n();
	const hintId = useId();
	// A locked mode explains itself while it is focused or hovered.
	const [explained, setExplained] = useState<AutomationMode | null>(null);
	const label = (mode: AutomationMode) => t(`aiPage.mode.${mode}.label`);
	const explainedLock = explained ? modeLockMessage(t, explained, capabilities) : null;
	const automatic = effective.effective === "AUTO" || effective.effective === "FULL_AUTO";
	const hint = explainedLock
		?? (!hostingEnabled
			? t("aiPage.mode.hostingOff")
			: automatic && capabilities.aiCommandPolicy === "always"
				? t("aiPage.mode.policyAlways")
				: modeHint(t, effective.effective, capabilities));
	const downgraded = hostingEnabled && effective.downgraded && effective.reasons.length > 0;
	const canCycle = hostingEnabled && permittedModes(capabilities).length > 1;

	return (
		<div data-ai-mode-switcher className={cn("min-w-0", className)}>
			<div className="flex min-w-0 flex-wrap items-center gap-2">
				<div
					role="group"
					aria-label={t("aiPage.mode.groupLabel")}
					aria-describedby={hintId}
					aria-busy={busy || undefined}
					data-hosting={hostingEnabled ? "on" : "off"}
					data-inset
					className={cn("inline-flex max-w-full gap-0.5 overflow-x-auto p-0.5", !hostingEnabled && "opacity-80")}
				>
					{AUTOMATION_MODES.map((mode) => {
						const lock = modeLockMessage(t, mode, capabilities);
						const selected = hostingEnabled && mode === requested;
						return (
							<button
								key={mode}
								type="button"
								data-mode={mode}
								aria-pressed={selected}
								aria-disabled={lock || busy ? "true" : undefined}
								aria-label={lock ? t("aiPage.mode.lockedAria", { mode: label(mode) }) : undefined}
								title={lock ?? modeHint(t, mode, capabilities)}
								onClick={() => {
									if (busy) return;
									onRequestMode(mode);
								}}
								onFocus={() => setExplained(lock ? mode : null)}
								onBlur={() => setExplained(null)}
								onMouseEnter={() => lock && setExplained(mode)}
								onMouseLeave={() => setExplained(null)}
								className={cn(
									"inline-flex min-h-[var(--control-height-xs)] shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition",
									selected
										? mode === "FULL_AUTO"
											? "bg-[var(--surface)] text-[var(--danger)] shadow-[var(--shadow-sm)]"
											: mode === "AUTO"
												? "bg-[var(--surface)] text-[var(--warning)] shadow-[var(--shadow-sm)]"
												: "bg-[var(--surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]"
										: "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
									lock && "cursor-not-allowed opacity-60 hover:text-[var(--text-muted)]",
								)}
							>
								{lock ? <LockGlyph /> : mode === "FULL_AUTO" ? <Zap size={12} aria-hidden /> : null}
								<span>{label(mode)}</span>
							</button>
						);
					})}
				</div>
				{downgraded ? (
					<Badge tone="warning" data-effective-mode={effective.effective}>
						{t("aiPage.mode.effectiveWithReason", {
							mode: label(effective.effective),
							reason: t(`aiPage.mode.reason.${effective.reasons[0]}`),
						})}
					</Badge>
				) : null}
				{showShortcutHint && canCycle ? (
					<span className="hidden text-[11px] text-[var(--text-muted)] sm:inline">{t("aiPage.mode.shortcutHint")}</span>
				) : null}
			</div>
			<p id={hintId} className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]" aria-live="polite">
				{busy ? t("aiPage.mode.saving") : hint}
			</p>
		</div>
	);
}
