"use client";

import type { Dispatch, SetStateAction } from "react";
import type { CostCategory, CostCurrency } from "@/lib/cost/types";
import { CATEGORIES, buttonGhost, buttonPrimary, cardClass, inputClass, labelClass } from "./cost-page-shared";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";

type T = (key: string) => string;
type CostForm = { category: CostCategory; provider: string; amount: string; currency: CostCurrency; effectiveDate: string; notes: string };

export function CostEntryFormModal({ open, editingId, form, availableCurrencies, saving, setForm, setShowForm, setEditingId, submitForm, t }: { open: boolean; editingId: string | null; form: CostForm; availableCurrencies: CostCurrency[]; saving: boolean; setForm: Dispatch<SetStateAction<CostForm>>; setShowForm: Dispatch<SetStateAction<boolean>>; setEditingId: Dispatch<SetStateAction<string | null>>; submitForm: () => void; t: T }) {
	const dialogRef = useDialogFocus<HTMLDivElement>({ open, onClose: () => setShowForm(false) });
	return open ? (
				<div
					ref={dialogRef}
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
					role="dialog"
					aria-modal="true"
				>
					<div className={`${cardClass} w-full max-w-md space-y-4`}>
						<h3 className="text-base font-semibold text-[var(--text-primary)]">
							{editingId ? t("costPage.form.editTitle") : t("costPage.form.title")}
						</h3>
						<div>
							<label className={labelClass} htmlFor="cost-category">
								{t("costPage.form.category")}
							</label>
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
						</div>
						<div>
							<label className={labelClass} htmlFor="cost-provider">
								{t("costPage.form.provider")}
							</label>
							<input
								id="cost-provider"
								className={inputClass}
								placeholder={t("costPage.form.providerPlaceholder")}
								value={form.provider}
								onChange={(e) => setForm({ ...form, provider: e.target.value })}
							/>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<div>
								<label className={labelClass} htmlFor="cost-amount">
									{t("costPage.form.amount")}
								</label>
								<input
									id="cost-amount"
									className={`${inputClass} font-mono`}
									inputMode="decimal"
									placeholder={t("costPage.form.amountPlaceholder")}
									value={form.amount}
									onChange={(e) => setForm({ ...form, amount: e.target.value })}
								/>
							</div>
							<div>
								<label className={labelClass} htmlFor="cost-currency">
									{t("costPage.form.currency")}
								</label>
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
							</div>
						</div>
						<div>
							<label className={labelClass} htmlFor="cost-effective-date">
								{t("costPage.form.effectiveDate")}
							</label>
							<input
								id="cost-effective-date"
								type="date"
								className={inputClass}
								value={form.effectiveDate}
								onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })}
							/>
						</div>
						<div>
							<label className={labelClass} htmlFor="cost-notes">
								{t("costPage.form.notes")}
							</label>
							<textarea
								id="cost-notes"
								className={`${inputClass} min-h-[60px]`}
								placeholder={t("costPage.form.notesPlaceholder")}
								value={form.notes}
								onChange={(e) => setForm({ ...form, notes: e.target.value })}
							/>
						</div>
						<div className="flex justify-end gap-2 pt-2">
							<button
								type="button"
								className={buttonGhost}
								onClick={() => {
									setShowForm(false);
									setEditingId(null);
								}}
								disabled={saving}
							>
								{t("costPage.form.cancel")}
							</button>
							<button
								type="button"
								className={buttonPrimary}
								onClick={submitForm}
								disabled={saving}
							>
								{saving ? t("costPage.actions.saving") : t("costPage.form.submit")}
							</button>
						</div>
					</div>
				</div>
			) : null;
}

export function CostDeleteDialog({ confirmDelete, deletingId, setConfirmDelete, onConfirmDelete, t }: { confirmDelete: { id: string; provider: string; amount: string } | null; deletingId: string | null; setConfirmDelete: Dispatch<SetStateAction<{ id: string; provider: string; amount: string } | null>>; onConfirmDelete: () => void; t: T }) {
	const dialogRef = useDialogFocus<HTMLDivElement>({ open: confirmDelete !== null, onClose: () => setConfirmDelete(null) });
	return confirmDelete ? (
				<div
					ref={dialogRef}
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
					role="alertdialog"
					aria-modal="true"
				>
					<div className={`${cardClass} w-full max-w-sm space-y-4`}>
						<h3 className="text-base font-semibold text-[var(--text-primary)]">
							{t("costPage.delete.title")}
						</h3>
						<p className="text-sm text-[var(--text-primary)]/70">
							{t("costPage.delete.confirm")
								.replace("{provider}", confirmDelete.provider)
								.replace("{amount}", confirmDelete.amount)}
						</p>
						<div className="flex justify-end gap-2">
							<button
								type="button"
								className={buttonGhost}
								onClick={() => setConfirmDelete(null)}
								disabled={deletingId === confirmDelete.id}
							>
								{t("costPage.delete.cancel")}
							</button>
							<button
								type="button"
								className={buttonPrimary}
								onClick={onConfirmDelete}
								disabled={deletingId === confirmDelete.id}
							>
								{deletingId === confirmDelete.id
									? t("costPage.actions.deleting")
									: t("costPage.delete.confirmBtn")}
							</button>
						</div>
					</div>
				</div>
			) : null;
}
