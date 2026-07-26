"use client";

import { useCallback } from "react";

import { ActionButton } from "@/components/action-button";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
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
	const dialogRef = useDialogFocus<HTMLDivElement>({
		open: rulePendingDelete !== null,
		onClose: closeDeleteDialog,
	});

	if (!rulePendingDelete) return null;

	return (
		<div
			ref={dialogRef}
			className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			aria-labelledby="delete-alert-rule-title"
		>
			<div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-5 shadow-2xl shadow-black/30">
				<h3
					id="delete-alert-rule-title"
					className="text-base font-semibold text-[var(--text-primary)]"
				>
					{t("alertRulesPage.delete.title")}
				</h3>
				<p className="mt-2 text-sm text-[var(--text-muted)]">
					{t("alertRulesPage.delete.confirm").replace(
						"{name}",
						rulePendingDelete.name,
					)}
				</p>
				<div className="mt-5 flex justify-end gap-2">
					<ActionButton
						type="button"
						variant="secondary"
						onClick={() => setRulePendingDelete(null)}
					>
						{t("alertRulesPage.delete.cancel")}
					</ActionButton>
					<ActionButton
						type="button"
						variant="danger"
						onClick={() => deleteRule(rulePendingDelete.id)}
						disabled={busyAction === `delete:${rulePendingDelete.id}`}
					>
						{busyAction === `delete:${rulePendingDelete.id}`
							? t("alertRulesPage.delete.deleting")
							: t("alertRulesPage.delete.confirmBtn")}
					</ActionButton>
				</div>
			</div>
		</div>
	);
}
