"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";

export function CreateAnnouncementForm() {
	const { t } = useI18n();
	const router = useRouter();
	const titleId = useId();
	const typeId = useId();
	const contentId = useId();
	const startsAtId = useId();
	const expiresAtId = useId();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setLoading(true);
		setError(null);
		const form = event.currentTarget;
		const data = Object.fromEntries(new FormData(form));
		try {
			await csrfFetch("/api/announcements", {
				method:"POST",
				headers: {"Content-Type":"application/json" },
				body: JSON.stringify({
					title: data.title,
					content: data.content,
					type: data.type ||"info",
					startsAt: data.startsAt || undefined,
					expiresAt: data.expiresAt || undefined,
				}),
			});
			form.reset();
			router.refresh();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("announcementsPage.create.error"));
		} finally {
			setLoading(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} data-card className="space-y-4">
			<h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("announcementsPage.create.title")}</h2>
			{error && <p className="text-xs text-[var(--danger)] dark:text-[var(--danger)]">{error}</p>}
			<div className="grid gap-3 md:grid-cols-2">
				<div className="grid gap-1.5">
					<label htmlFor={titleId} className="text-xs font-medium text-[var(--text-secondary)]">{t("announcementsPage.create.titleLabel")}</label>
					<input id={titleId} name="title" required aria-describedby={`${titleId}-hint`} className={UI_INPUT} />
					<p id={`${titleId}-hint`} className="text-[11px] text-[var(--text-muted)]">{t("announcementsPage.create.titleHint")}</p>
				</div>
				<div className="grid gap-1.5">
					<label htmlFor={typeId} className="text-xs font-medium text-[var(--text-secondary)]">{t("announcementsPage.create.typeLabel")}</label>
					<select id={typeId} name="type" defaultValue="info" className={UI_INPUT}>
						<option value="info">{t("announcementsPage.create.type.info")}</option>
						<option value="warning">{t("announcementsPage.create.type.warning")}</option>
						<option value="urgent">{t("announcementsPage.level.urgent")}</option>
					</select>
					<p className="text-[11px] text-[var(--text-muted)]">{t("announcementsPage.create.typeHint")}</p>
				</div>
			</div>
			<div className="grid gap-1.5">
				<label htmlFor={contentId} className="text-xs font-medium text-[var(--text-secondary)]">{t("announcementsPage.create.contentLabel")}</label>
				<textarea id={contentId} name="content" required rows={3} aria-describedby={`${contentId}-hint`} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-y" />
				<p id={`${contentId}-hint`} className="text-[11px] text-[var(--text-muted)]">{t("announcementsPage.create.contentHint")}</p>
			</div>
			<div className="grid gap-3 md:grid-cols-2">
				<div className="grid gap-1.5">
					<label htmlFor={startsAtId} className="text-xs font-medium text-[var(--text-secondary)]">{t("announcementsPage.create.startsAtLabel")}</label>
					<input id={startsAtId} type="datetime-local" name="startsAt" aria-describedby={`${startsAtId}-hint`} className={UI_INPUT} />
					<p id={`${startsAtId}-hint`} className="text-[11px] text-[var(--text-muted)]">{t("announcementsPage.create.startsAtHint")}</p>
				</div>
				<div className="grid gap-1.5">
					<label htmlFor={expiresAtId} className="text-xs font-medium text-[var(--text-secondary)]">{t("common.expiration")}</label>
					<input id={expiresAtId} type="datetime-local" name="expiresAt" aria-describedby={`${expiresAtId}-hint`} className={UI_INPUT} />
					<p id={`${expiresAtId}-hint`} className="text-[11px] text-[var(--text-muted)]">{t("announcementsPage.create.expiresAtHint")}</p>
				</div>
			</div>
			<button disabled={loading} data-action-button data-variant="primary" className="w-fit disabled:opacity-60">
				{loading ? t("announcementsPage.create.submitting") : t("announcementsPage.create.submit")}
			</button>
		</form>
	);
}
