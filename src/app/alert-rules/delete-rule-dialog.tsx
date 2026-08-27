"use client";

import { useCallback } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { useI18n } from "@/lib/i18n/use-locale";

import type { AlertRule } from "./alert-rule-types";

type Props = {
	rulePendingDelete: AlertRule | null;
	busyAction: string | null;
	setRulePendingDelete: (rule: AlertRule | null) => void;
	deleteRule: (id: string) => Promise<void>;
};

export function DeleteRuleDialog({
	rulePendingDelete,
	busyAction,
	setRulePendingDelete,
	deleteRule,
}: Props) {
	const { t } = useI18n();
	const closeDeleteDialog = useCallback(
		() => setRulePendingDelete(null),
		[setRulePendingDelete],
	);

	if (!rulePendingDelete) return null;

	const deleting = busyAction === `delete:${rulePendingDelete.id}`;

	return (
		<ConfirmDialog
			open
			title={t("alertRulesPage.delete.title")}
			description={t("alertRulesPage.delete.confirm").replace("{name}", rulePendingDelete.name)}
			cancelLabel={t("alertRulesPage.delete.cancel")}
			confirmLabel={deleting ? t("alertRulesPage.delete.deleting") : t("alertRulesPage.delete.confirmBtn")}
			busy={deleting}
			onCancel={closeDeleteDialog}
			onConfirm={() => deleteRule(rulePendingDelete.id)}
			closeOnBackdrop={false}
		/>
	);
}
