"use client";

import { ActionButton } from "@/components/action-button";
import { Toolbar } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n/use-locale";

import { deliveryStatusLabel, type TestDelivery } from "./alert-rule-types";

export function AlertRulesToolbar({
	canManage,
	rulesEmpty,
	showCreate,
	setShowCreate,
	busyAction,
	ensureDefaults,
	triggerNow,
}: {
	canManage: boolean;
	rulesEmpty: boolean;
	showCreate: boolean;
	setShowCreate: (show: boolean) => void;
	busyAction: string | null;
	ensureDefaults: () => Promise<void>;
	triggerNow: () => Promise<void>;
}) {
	const { t } = useI18n();
	return (
		<Toolbar className="flex-wrap">
			{canManage && (
				<>
					{rulesEmpty ? (
						<ActionButton
							type="button"
							variant="primary"
							onClick={() => void ensureDefaults()}
							disabled={busyAction === "defaults"}
						>
							{busyAction === "defaults"
								? t("alertRulesPage.action.processing")
								: t("alertRulesPage.ensureDefaults")}
						</ActionButton>
					) : null}
					{!showCreate && (
						<ActionButton type="button" variant="outline" onClick={() => setShowCreate(true)}>
							{t("alertRulesPage.create")}
						</ActionButton>
					)}
					<ActionButton
						type="button"
						variant="secondary"
						onClick={triggerNow}
						disabled={busyAction === "trigger"}
					>
						{busyAction === "trigger"
							? t("alertRulesPage.triggering")
							: t("alertRulesPage.triggerNow")}
					</ActionButton>
				</>
			)}
		</Toolbar>
	);
}

export function TestResultPanel({
	testResult,
}: {
	testResult: { ruleName: string; deliveries: TestDelivery[] } | null;
}) {
	const { t } = useI18n();
	if (!testResult) return null;
	return (
		<div
			role="status"
			data-tone="cyan"
			className="rounded-xl border border-[var(--color-action-border)]/20 px-4 py-3 text-sm text-[var(--text-primary)]"
		>
			<p className="font-medium">
				{t("alertRulesPage.testResult", { ruleName: testResult.ruleName })}
			</p>
			<ul className="mt-2 space-y-1">
				{testResult.deliveries.map((delivery, index) => (
					<li key={`${delivery.channel}-${index}`} className="flex flex-wrap gap-2 text-xs">
						<span className="font-mono uppercase">{delivery.channel}</span>
						<span>{deliveryStatusLabel(t, delivery.status)}</span>
						<span className="text-[var(--text-primary)]/70">{delivery.message}</span>
					</li>
				))}
			</ul>
		</div>
	);
}
