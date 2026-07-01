"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import type { Locale } from "@/lib/i18n/translations";

type Props = { locale?: Locale };

export function CreateTicketForm(_props: Props = {}) {
	const router = useRouter();
	const { t } = useI18n();
	const [state, formAction, pending] = useActionState(async (_prev: { error?: string } | null, formData: FormData) => {
		const title = String(formData.get("subject") ?? "").trim();
		const description = String(formData.get("description") ?? "").trim();
		const priority = String(formData.get("priority") ?? "NORMAL").toUpperCase();
		if (!title || !description) return { error: t("ticketsPage.form.error.empty") };
		try {
			await csrfFetch("/api/tickets", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ subject: title, description, priority }),
			});
			router.refresh();
			return null;
		} catch (err) {
			return { error: err instanceof Error ? err.message : t("ticketsPage.form.error.createFailed") };
		}
	}, null);

	return (
		<form action={formAction} data-card className=" space-y-4">
			<h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("ticketsPage.form.title")}</h2>
			{state?.error && <p className="text-xs text-rose-400">{state.error}</p>}
			<div className="grid gap-3 md:grid-cols-2">
				<label className="grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
					{t("ticketsPage.form.label.title")}
					<input name="subject" required placeholder={t("ticketsPage.form.subject")} className="rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]" />
				</label>
				<label className="grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
					{t("ticketsPage.form.label.priority")}
					<select name="priority" defaultValue="NORMAL" className="rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]">
						<option value="LOW">{t("ticketsPage.priority.LOW")}</option>
						<option value="NORMAL">{t("ticketsPage.priority.NORMAL")}</option>
						<option value="HIGH">{t("ticketsPage.priority.HIGH")}</option>
						<option value="URGENT">{t("ticketsPage.priority.URGENT")}</option>
					</select>
				</label>
			</div>
			<label className="grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
				{t("ticketsPage.form.label.description")}
				<textarea name="description" required rows={4} placeholder={t("ticketsPage.form.description")} className="rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-y" />
			</label>
			<button disabled={pending} className="w-fit rounded-lg bg-[var(--color-action-bg)] px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60">
				{pending ? t("ticketsPage.form.submitting") : t("ticketsPage.form.submit")}
			</button>
		</form>
	);
}
