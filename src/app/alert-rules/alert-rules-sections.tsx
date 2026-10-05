"use client";

import { ActionButton } from "@/components/action-button";
import { Plus } from "@/components/icons";
import { Toolbar } from "@/components/page-shell";
import { Notice } from "@/components/ui-primitives";
import { useI18n } from "@/lib/i18n/use-locale";

import { deliveryStatusLabel, type TestDelivery } from "./alert-rule-types";

export function AlertRulesToolbar({
	canManage,
	showCreate,
	setShowCreate,
	busyAction,
	triggerNow,
}: {
	canManage: boolean;
	showCreate: boolean;
	setShowCreate: (show: boolean) => void;
	busyAction: string | null;
	triggerNow: () => Promise<void>;
}) {
	const { t } = useI18n();
	if (!canManage) return null;
	return (
		<Toolbar className="mb-0">
			{!showCreate && (
				<ActionButton icon={<Plus size={16} aria-hidden />} onClick={() => setShowCreate(true)}>
					{t("alertRulesPage.create")}
				</ActionButton>
			)}
			<ActionButton variant="secondary" onClick={triggerNow} loading={busyAction === "trigger"}>
				{busyAction === "trigger" ? t("alertRulesPage.triggering") : t("alertRulesPage.triggerNow")}
			</ActionButton>
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
		<Notice tone="info" title={t("alertRulesPage.testResult", { ruleName: testResult.ruleName })}>
			<ul className="mt-1 space-y-1">
				{testResult.deliveries.map((delivery, index) => (
					<li key={`${delivery.channel}-${index}`} className="flex flex-wrap gap-2 text-xs">
						<span className="ui-mono uppercase text-[var(--text-primary)]">{delivery.channel}</span>
						<span>{deliveryStatusLabel(t, delivery.status)}</span>
						<span className="text-[var(--text-muted)]">{delivery.message}</span>
					</li>
				))}
			</ul>
		</Notice>
	);
}
