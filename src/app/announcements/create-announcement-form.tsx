"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

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
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: data.title,
					content: data.content,
					type: data.type || "info",
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
		<form onSubmit={handleSubmit} data-card className=" space-y-4">
			<h2 className="text-sm font-semibold text-white">{t("announcementsPage.create.title")}</h2>
			{error && <p className="text-xs text-rose-400">{error}</p>}
			<div className="grid gap-3 md:grid-cols-2">
				<div className="grid gap-1.5">
					<label htmlFor={titleId} className="text-xs font-medium text-[var(--text-secondary)]">{t("announcementsPage.create.titleLabel")}</label>
					<input id={titleId} name="title" required aria-describedby={`${titleId}-hint`} className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600" />
					<p id={`${titleId}-hint`} className="text-[11px] text-slate-500">{t("announcementsPage.create.titleHint")}</p>
				</div>
				<div className="grid gap-1.5">
					<label htmlFor={typeId} className="text-xs font-medium text-[var(--text-secondary)]">{t("announcementsPage.create.typeLabel")}</label>
					<select id={typeId} name="type" defaultValue="info" className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100">
						<option value="info">{t("announcementsPage.create.type.info")}</option>
						<option value="warning">{t("announcementsPage.create.type.warning")}</option>
						<option value="urgent">{t("announcementsPage.level.urgent")}</option>
					</select>
					<p className="text-[11px] text-slate-500">{t("announcementsPage.create.typeHint")}</p>
				</div>
			</div>
			<div className="grid gap-1.5">
				<label htmlFor={contentId} className="text-xs font-medium text-[var(--text-secondary)]">{t("announcementsPage.create.contentLabel")}</label>
				<textarea id={contentId} name="content" required rows={3} aria-describedby={`${contentId}-hint`} className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 resize-y" />
				<p id={`${contentId}-hint`} className="text-[11px] text-slate-500">{t("announcementsPage.create.contentHint")}</p>
			</div>
			<div className="grid gap-3 md:grid-cols-2">
				<div className="grid gap-1.5">
					<label htmlFor={startsAtId} className="text-xs font-medium text-[var(--text-secondary)]">{t("announcementsPage.create.startsAtLabel")}</label>
					<input id={startsAtId} type="datetime-local" name="startsAt" aria-describedby={`${startsAtId}-hint`} className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100" />
					<p id={`${startsAtId}-hint`} className="text-[11px] text-slate-500">{t("announcementsPage.create.startsAtHint")}</p>
				</div>
				<div className="grid gap-1.5">
					<label htmlFor={expiresAtId} className="text-xs font-medium text-[var(--text-secondary)]">{t("common.expiration")}</label>
					<input id={expiresAtId} type="datetime-local" name="expiresAt" aria-describedby={`${expiresAtId}-hint`} className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100" />
					<p id={`${expiresAtId}-hint`} className="text-[11px] text-slate-500">{t("announcementsPage.create.expiresAtHint")}</p>
				</div>
			</div>
			<button disabled={loading} className="w-fit rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60">
				{loading ? t("announcementsPage.create.submitting") : t("announcementsPage.create.submit")}
			</button>
		</form>
	);
}
