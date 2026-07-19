"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";
import type { Locale } from "@/lib/i18n/translations";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";

type Props = { locale?: Locale; servers?: { id: string; name: string; host: string }[] };

export function CreateTicketForm({ locale: _locale, servers = [] }: Props = {}) {
	const router = useRouter();
	const { t } = useI18n();
	const { addToast } = useToast();
	const [state, formAction, pending] = useActionState(async (_prev: { error?: string; success?: boolean } | null, formData: FormData) => {
		const title = String(formData.get("subject") ?? "").trim();
		const description = String(formData.get("description") ?? "").trim();
		const priority = String(formData.get("priority") ?? "NORMAL").toUpperCase();
		const category = String(formData.get("category") ?? "request");
		if (!title || !description) return { error: t("ticketsPage.form.error.empty") };
		try {
			await csrfFetch("/api/tickets", {
				method:"POST",
				headers: {"Content-Type":"application/json" },
				body: JSON.stringify({ subject: title, description, priority, category, relatedServerId: String(formData.get("relatedServerId") ?? "") || undefined }),
			});
			router.refresh();
			return { success: true };
		} catch (err) {
			return { error: err instanceof Error ? err.message : t("ticketsPage.form.error.createFailed") };
		}
	}, null);

	useEffect(() => {
		if (state?.success) {
			addToast("success", t("ticketsPage.form.success.created"));
		} else if (state?.error) {
			addToast("error", state.error);
		}
	}, [state, addToast, t]);

	return (
		<form action={formAction} data-card className="space-y-4 p-5">
			<div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
						{t("ticketsPage.form.title")}
					</p>
					<h2 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{t("ticketsPage.form.title")}</h2>
				</div>
			</div>
			{state?.error && (
				<p role="alert" className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger)]">
					{state.error}
				</p>
			)}
			<div className="grid gap-3 md:grid-cols-3">
				<label className="grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
					{t("ticketsPage.form.label.title")}
					<input
						name="subject"
						required
						placeholder={t("ticketsPage.form.subject")}
						className={UI_INPUT}
					/>
				</label>
				<label className="grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
					{t("ticketsPage.form.label.category")}
					<select
						name="category"
						defaultValue="request"
						className={UI_INPUT}
					>
						<option value="incident">{t("ticketsPage.category.incident")}</option>
						<option value="request">{t("ticketsPage.category.request")}</option>
						<option value="question">{t("ticketsPage.category.question")}</option>
						<option value="feedback">{t("ticketsPage.category.feedback")}</option>
					</select>
				</label>
				<label className="grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
					{t("ticketsPage.form.label.priority")}
					<select
						name="priority"
						defaultValue="NORMAL"
						className={UI_INPUT}
					>
						<option value="LOW">{t("ticketsPage.priority.LOW")}</option>
						<option value="NORMAL">{t("ticketsPage.priority.NORMAL")}</option>
						<option value="HIGH">{t("ticketsPage.priority.HIGH")}</option>
						<option value="URGENT">{t("ticketsPage.priority.URGENT")}</option>
					</select>
				</label>
			</div>
			{servers.length > 0 && (
				<label className="grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
					{t("ticketsPage.form.label.relatedServer")}
					<select
						name="relatedServerId"
						defaultValue=""
						className={UI_INPUT}
					>
						<option value="">{t("ticketsPage.form.noRelatedServer")}</option>
						{servers.map((s) => (
							<option key={s.id} value={s.id}>{s.name} ({s.host})</option>
						))}
					</select>
				</label>
			)}
			<label className="grid gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
				{t("ticketsPage.form.label.description")}
				<textarea
					name="description"
					required
					rows={4}
					placeholder={t("ticketsPage.form.description")}
					className={cn(UI_INPUT,"min-h-[6rem] resize-y")}
				/>
			</label>
			<button
				disabled={pending}
				data-primary
				data-action-button data-variant="primary" className="w-fit px-4 py-2.5 text-sm"
			>
				{pending ? t("ticketsPage.form.submitting") : t("ticketsPage.form.submit")}
			</button>
		</form>
	);
}
