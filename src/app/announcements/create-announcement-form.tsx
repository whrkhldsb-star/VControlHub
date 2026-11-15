"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { Notice } from "@/components/ui-primitives";
import { useToast } from "@/components/toast-provider";
import { useUnsavedChangesGuard } from "@/lib/forms/use-unsaved-changes-guard";

/** The fields of a new announcement; its panel (title, card) is the page's. */
export function CreateAnnouncementForm({ onClose }: {
	/** Closes the form: once the announcement is posted, or on Cancel (which asks first when something was typed). */
	onClose: () => void;
}) {
	const { t } = useI18n();
	const router = useRouter();
	const { addToast } = useToast();
	const titleId = useId();
	const typeId = useId();
	const contentId = useId();
	const startsAtId = useId();
	const expiresAtId = useId();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const { requestDiscard, discardDialog } = useUnsavedChangesGuard({ dirty, onDiscard: onClose });

	/** datetime-local is "YYYY-MM-DDTHH:mm" without timezone; API requires ISO with offset. */
	const toIsoOrUndefined = (value: FormDataEntryValue | undefined) => {
		if (typeof value !== "string" || !value.trim()) return undefined;
		const d = new Date(value);
		if (Number.isNaN(d.getTime())) return undefined;
		return d.toISOString();
	};

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
					published: true,
					startsAt: toIsoOrUndefined(data.startsAt),
					expiresAt: toIsoOrUndefined(data.expiresAt),
				}),
			});
			addToast("success", t("announcementsPage.toast.created"));
			router.refresh();
			// The fields stay editable while posting. The form closes only if they still hold what was sent: a next
			// announcement typed meanwhile stays, as it is.
			const current = Object.fromEntries(new FormData(form));
			if (Object.keys(data).every((key) => current[key] === data[key])) {
				setDirty(false);
				onClose();
			}
		} catch (err) {
			setError(getErrorMessage(err, t("announcementsPage.create.error")));
		} finally {
			setLoading(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} onChange={() => setDirty(true)} className="space-y-4">
			{error && <Notice tone="danger" compact>{error}</Notice>}
			<div className="grid gap-3 md:grid-cols-2">
				<div className="grid gap-1.5">
					<label htmlFor={titleId} className="ui-label">{t("announcementsPage.create.titleLabel")}</label>
					<input id={titleId} name="title" required aria-describedby={`${titleId}-hint`} className={UI_INPUT} />
					<p id={`${titleId}-hint`} className="text-xs text-[var(--text-muted)]">{t("announcementsPage.create.titleHint")}</p>
				</div>
				<div className="grid gap-1.5">
					<label htmlFor={typeId} className="ui-label">{t("announcementsPage.create.typeLabel")}</label>
					<select id={typeId} name="type" defaultValue="info" aria-describedby={`${typeId}-hint`} className={UI_INPUT}>
						<option value="info">{t("announcementsPage.level.info")}</option>
						<option value="warning">{t("announcementsPage.level.warning")}</option>
						<option value="urgent">{t("announcementsPage.level.urgent")}</option>
					</select>
					<p id={`${typeId}-hint`} className="text-xs text-[var(--text-muted)]">{t("announcementsPage.create.typeHint")}</p>
				</div>
			</div>
			<div className="grid gap-1.5">
				<label htmlFor={contentId} className="ui-label">{t("announcementsPage.create.contentLabel")}</label>
				<textarea id={contentId} name="content" required rows={3} aria-describedby={`${contentId}-hint`} className={cn(UI_INPUT, "resize-y")} />
				<p id={`${contentId}-hint`} className="text-xs text-[var(--text-muted)]">{t("announcementsPage.create.contentHint")}</p>
			</div>
			<div className="grid gap-3 md:grid-cols-2">
				<div className="grid gap-1.5">
					<label htmlFor={startsAtId} className="ui-label">{t("announcementsPage.create.startsAtLabel")}</label>
					<input id={startsAtId} type="datetime-local" name="startsAt" aria-describedby={`${startsAtId}-hint`} className={UI_INPUT} />
					<p id={`${startsAtId}-hint`} className="text-xs text-[var(--text-muted)]">{t("announcementsPage.create.startsAtHint")}</p>
				</div>
				<div className="grid gap-1.5">
					<label htmlFor={expiresAtId} className="ui-label">{t("common.expiration")}</label>
					<input id={expiresAtId} type="datetime-local" name="expiresAt" aria-describedby={`${expiresAtId}-hint`} className={UI_INPUT} />
					<p id={`${expiresAtId}-hint`} className="text-xs text-[var(--text-muted)]">{t("announcementsPage.create.expiresAtHint")}</p>
				</div>
			</div>
			<div className="flex flex-wrap gap-3">
				<ActionButton type="submit" variant="primary" disabled={loading}>
					{loading ? t("announcementsPage.create.submitting") : t("announcementsPage.create.submit")}
				</ActionButton>
				<ActionButton type="button" variant="secondary" disabled={loading} onClick={requestDiscard}>
					{t("common.cancel")}
				</ActionButton>
			</div>
			{discardDialog}
		</form>
	);
}
