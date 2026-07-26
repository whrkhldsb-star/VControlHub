"use client";

import type { Dispatch, SetStateAction } from "react";
import type { CostCategory, CostCurrency } from "@/lib/cost/types";
import { CATEGORIES, buttonGhost, buttonPrimary, cardClass, inputClass, labelClass } from "./cost-page-shared";
import { ActionButton } from "@/components/action-button";
import { ModalShell } from "@/components/modal-shell";

type T = (key: string, vars?: Record<string, string | number>) => string;
type CostForm = { category: CostCategory; provider: string; amount: string; currency: CostCurrency; effectiveDate: string; notes: string };

export function CostEntryFormModal({ open, editingId, form, availableCurrencies, saving, setForm, setShowForm, setEditingId, submitForm, t }: { open: boolean; editingId: string | null; form: CostForm; availableCurrencies: CostCurrency[]; saving: boolean; setForm: Dispatch<SetStateAction<CostForm>>; setShowForm: Dispatch<SetStateAction<boolean>>; setEditingId: Dispatch<SetStateAction<string | null>>; submitForm: () => void; t: T }) {
	return (
		<ModalShell
			open={open}
			onClose={() => setShowForm(false)}
			labelledBy="cost-entry-form-title"
			overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4"
			panelClassName={`${cardClass} w-full max-w-md space-y-4`}
			closeOnBackdrop={false}
		>
						<h3 id="cost-entry-form-title" className="text-base font-semibold text-[var(--text-primary)]">
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
							<ActionButton variant="secondary" className={buttonGhost}
								onClick={() => {
									setShowForm(false);
									setEditingId(null);
								}}
								disabled={saving}
							>
								{t("costPage.form.cancel")}
							</ActionButton>
							<ActionButton variant="primary" className={buttonPrimary}
								onClick={submitForm}
								disabled={saving}
							>
								{saving ? t("costPage.actions.saving") : t("costPage.form.submit")}
								</ActionButton>
								</div>
								</ModalShell>
								);
								}

export function CostDeleteDialog({ confirmDelete, deletingId, setConfirmDelete, onConfirmDelete, t }: { confirmDelete: { id: string; provider: string; amount: string } | null; deletingId: string | null; setConfirmDelete: Dispatch<SetStateAction<{ id: string; provider: string; amount: string } | null>>; onConfirmDelete: () => void; t: T }) {
	return confirmDelete ? (
		<ModalShell
			open={confirmDelete !== null}
			onClose={() => setConfirmDelete(null)}
			labelledBy="cost-delete-dialog-title"
			overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4"
			panelClassName={`${cardClass} w-full max-w-sm space-y-4`}
			closeOnBackdrop={false}
			role="alertdialog"
		>
						<h3 id="cost-delete-dialog-title" className="text-base font-semibold text-[var(--text-primary)]">
							{t("costPage.delete.title")}
						</h3>
						<p className="text-sm text-[var(--text-primary)]/70">
							{t("costPage.delete.confirm", { provider: confirmDelete.provider, amount: confirmDelete.amount })}
						</p>
						<div className="flex justify-end gap-2">
							<ActionButton variant="secondary" className={buttonGhost}
								onClick={() => setConfirmDelete(null)}
								disabled={deletingId === confirmDelete.id}
							>
								{t("costPage.delete.cancel")}
							</ActionButton>
							<ActionButton variant="primary" className={buttonPrimary}
								onClick={onConfirmDelete}
								disabled={deletingId === confirmDelete.id}
							>
								{deletingId === confirmDelete.id
									? t("costPage.actions.deleting")
									: t("costPage.delete.confirmBtn")}
									</ActionButton>
									</div>
									</ModalShell>
									) : null;
									}
