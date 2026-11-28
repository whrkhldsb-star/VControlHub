"use client";

/**
 * Explicit confirmation before a conversation enters Full auto: what it allows, what it never allows, which
 * servers it reaches, and for how long (15 / 30 / 60 minutes, capped by the platform's maximum).
 */
import { useState } from "react";

import { ActionButton } from "@/components/action-button";
import { AlertTriangle } from "@/components/icons";
import { Dialog } from "@/components/ui/dialog";
import { Notice, SegmentedControl } from "@/components/ui-primitives";
import { useI18n } from "@/lib/i18n/use-locale";

import { fullAutoTtlOptions } from "./ai-automation-mode";

export function AiFullAutoDialog({
	open,
	busy,
	maxTtlMinutes,
	defaultTtlMinutes,
	allowCritical,
	pinnedServerCount,
	onCancel,
	onConfirm,
}: {
	open: boolean;
	busy: boolean;
	maxTtlMinutes: number;
	defaultTtlMinutes: number;
	allowCritical: boolean;
	pinnedServerCount: number;
	onCancel: () => void;
	onConfirm: (ttlMinutes: number) => void;
}) {
	const { t } = useI18n();
	const options = fullAutoTtlOptions(maxTtlMinutes);
	const [ttl, setTtl] = useState(() => (options.includes(defaultTtlMinutes) ? defaultTtlMinutes : options[options.length - 1] ?? 15));

	return (
		<Dialog
			open={open}
			onClose={onCancel}
			busy={busy}
			role="alertdialog"
			closeOnBackdrop={false}
			icon={<AlertTriangle size={18} aria-hidden className="text-[var(--danger)]" />}
			title={t("aiPage.fullAuto.title")}
			description={t("aiPage.fullAuto.desc")}
			panelProps={{ "data-full-auto-dialog": "" }}
			footer={
				<>
					<ActionButton variant="secondary" disabled={busy} onClick={onCancel}>
						{t("aiPage.cancel")}
					</ActionButton>
					<ActionButton variant="danger-solid" loading={busy} onClick={() => onConfirm(ttl)}>
						{t("aiPage.fullAuto.confirm", { minutes: ttl })}
					</ActionButton>
				</>
			}
		>
			<div className="space-y-3 text-sm">
				<Notice tone="warning">{t("aiPage.fullAuto.warning")}</Notice>
				<ul className="list-disc space-y-1 pl-5 text-xs text-[var(--text-secondary)]">
					<li>{t(allowCritical ? "aiPage.fullAuto.criticalAllowedNote" : "aiPage.fullAuto.criticalNote")}</li>
					<li>
						{pinnedServerCount > 0
							? t("aiPage.fullAuto.pinsNote", { count: pinnedServerCount })
							: t("aiPage.fullAuto.noPinsNote")}
					</li>
				</ul>
				<div>
					<p className="ui-label mb-1.5">{t("aiPage.fullAuto.ttlLabel")}</p>
					<SegmentedControl
						ariaLabel={t("aiPage.fullAuto.ttlLabel")}
						options={options.map((minutes) => ({
							value: String(minutes),
							label: t("aiPage.fullAuto.ttlOption", { minutes }),
						}))}
						value={String(ttl)}
						onChange={(value) => setTtl(Number(value))}
						size="sm"
					/>
				</div>
			</div>
		</Dialog>
	);
}
