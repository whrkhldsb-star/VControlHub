"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";
import type { Locale } from "@/lib/i18n/translations";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { Notice } from "@/components/ui-primitives";
import { useUnsavedChangesGuard } from "@/lib/forms/use-unsaved-changes-guard";

type Props = { locale?: Locale; servers?: { id: string; name: string; host: string }[] };

export function CreateTicketForm({ locale: _locale, servers = [] }: Props = {}) {
	const router = useRouter();
	const { t } = useI18n();
	const { addToast } = useToast();
	const [dirty, setDirty] = useState(false);
  const { discardDialog } = useUnsavedChangesGuard({ dirty });
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
        setDirty(false);
			router.refresh();
			return { success: true };
		} catch (err) {
			return { error: getErrorMessage(err, t("ticketsPage.form.error.createFailed")) };
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
		<form action={formAction}
      onChange={() => setDirty(true)} data-card className="space-y-4 p-5">
			<div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
				<h2 className="ui-title-section">{t("ticketsPage.form.title")}</h2>
			</div>
			{state?.error && <Notice tone="danger" compact>{state.error}</Notice>}
			<div className="grid gap-3 md:grid-cols-3">
				<label className="ui-label grid gap-1.5">
					{t("ticketsPage.form.label.title")}
					<input
						name="subject"
						required
						placeholder={t("ticketsPage.form.subject")}
						className={UI_INPUT}
					/>
				</label>
				<label className="ui-label grid gap-1.5">
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
				<label className="ui-label grid gap-1.5">
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
				<label className="ui-label grid gap-1.5">
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
			<label className="ui-label grid gap-1.5">
				{t("ticketsPage.form.label.description")}
				<textarea
					name="description"
					required
					rows={4}
					placeholder={t("ticketsPage.form.description")}
					className={cn(UI_INPUT,"min-h-[6rem] resize-y")}
				/>
			</label>
			<ActionButton type="submit" variant="primary"
				disabled={pending}
			 className="w-fit"
			>
				{pending ? t("ticketsPage.form.submitting") : t("ticketsPage.form.submit")}
			</ActionButton>
      {discardDialog}
		</form>
	);
}
