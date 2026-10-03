"use client";

import type { Dispatch, SetStateAction } from "react";
import type { CostCategory, CostCurrency } from "@/lib/cost/types";
import { CATEGORIES, inputClass } from "./cost-page-shared";
import { ActionButton } from "@/components/action-button";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui-primitives";
import { ConfirmDialog } from "@/components/confirm-dialog";

type T = (key: string, vars?: Record<string, string | number>) => string;
type CostForm = { category: CostCategory; provider: string; amount: string; currency: CostCurrency; effectiveDate: string; notes: string };

export function CostEntryFormModal({ open, editingId, form, availableCurrencies, saving, setForm, setShowForm, setEditingId, submitForm, t }: { open: boolean; editingId: string | null; form: CostForm; availableCurrencies: CostCurrency[]; saving: boolean; setForm: Dispatch<SetStateAction<CostForm>>; setShowForm: Dispatch<SetStateAction<boolean>>; setEditingId: Dispatch<SetStateAction<string | null>>; submitForm: () => void; t: T }) {
	return (
		<Dialog
			size="md"
			open={open}
			onClose={() => setShowForm(false)}
			closeOnBackdrop={false}
			busy={saving}
			title={editingId ? t("costPage.form.editTitle") : t("costPage.form.title")}
			footer={<>
				<ActionButton variant="secondary"
					onClick={() => {
						setShowForm(false);
						setEditingId(null);
					}}
					disabled={saving}
				>
					{t("costPage.form.cancel")}
				</ActionButton>
				<ActionButton onClick={submitForm} loading={saving}>
					{saving ? t("costPage.actions.saving") : t("costPage.form.submit")}
				</ActionButton>
			</>}
		>
			<div className="space-y-4">
				<FormField label={t("costPage.form.category")} htmlFor="cost-category">
					<select
						id="cost-category"
						className={inputClass}
						value={form.category}
						onChange={(e) => setForm({ ...form, category: e.target.value as CostCategory })}
					>
						{CATEGORIES.map((c) => (
							<option key={c} value={c}>
								{t(`costPage.category.${c}`)}
							</option>
						))}
					</select>
				</FormField>
				<FormField label={t("costPage.form.provider")} htmlFor="cost-provider">
					<input
						id="cost-provider"
						className={inputClass}
						placeholder={t("costPage.form.providerPlaceholder")}
						value={form.provider}
						onChange={(e) => setForm({ ...form, provider: e.target.value })}
					/>
				</FormField>
				<div className="grid grid-cols-2 gap-3">
					<FormField label={t("costPage.form.amount")} htmlFor="cost-amount">
						<input
							id="cost-amount"
							className={`${inputClass} font-mono`}
							inputMode="decimal"
							placeholder={t("costPage.form.amountPlaceholder")}
							value={form.amount}
							onChange={(e) => setForm({ ...form, amount: e.target.value })}
						/>
					</FormField>
					<FormField label={t("costPage.form.currency")} htmlFor="cost-currency">
						<select
							id="cost-currency"
							className={inputClass}
							value={form.currency}
							onChange={(e) => setForm({ ...form, currency: e.target.value as CostCurrency })}
						>
							{availableCurrencies.map((c) => (
								<option key={c} value={c}>
									{t(`costPage.currency.${c}`)}
								</option>
							))}
						</select>
					</FormField>
				</div>
				<FormField label={t("costPage.form.effectiveDate")} htmlFor="cost-effective-date">
					<input
						id="cost-effective-date"
						type="date"
						className={inputClass}
						value={form.effectiveDate}
						onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })}
					/>
				</FormField>
				<FormField label={t("costPage.form.notes")} htmlFor="cost-notes">
					<textarea
						id="cost-notes"
						className={`${inputClass} min-h-[60px]`}
						placeholder={t("costPage.form.notesPlaceholder")}
						value={form.notes}
						onChange={(e) => setForm({ ...form, notes: e.target.value })}
					/>
				</FormField>
			</div>
		</Dialog>
	);
}

export function CostDeleteDialog({ confirmDelete, deletingId, setConfirmDelete, onConfirmDelete, t }: { confirmDelete: { id: string; provider: string; amount: string } | null; deletingId: string | null; setConfirmDelete: Dispatch<SetStateAction<{ id: string; provider: string; amount: string } | null>>; onConfirmDelete: () => void; t: T }) {
	return (
		<ConfirmDialog
			open={confirmDelete !== null}
			title={t("costPage.delete.title")}
			description={confirmDelete ? t("costPage.delete.confirm", { provider: confirmDelete.provider, amount: confirmDelete.amount }) : ""}
			cancelLabel={t("costPage.delete.cancel")}
			confirmLabel={confirmDelete && deletingId === confirmDelete.id ? t("costPage.actions.deleting") : t("costPage.delete.confirmBtn")}
			busy={confirmDelete ? deletingId === confirmDelete.id : false}
			onCancel={() => setConfirmDelete(null)}
			onConfirm={onConfirmDelete}
			closeOnBackdrop={false}
		/>
	);
}
