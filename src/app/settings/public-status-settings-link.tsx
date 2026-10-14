"use client";

import { ButtonLink } from "@/components/action-button";
import { useI18n } from "@/lib/i18n/use-locale";

/** Entry to the status board management page from the monitoring settings. */
export function PublicStatusSettingsLink() {
	const { t } = useI18n();
	return (
		<section id="public-status-board" data-card className="flex flex-wrap items-center justify-between gap-3 p-5" aria-labelledby="public-status-board-title">
			<div className="min-w-0">
				<h2 id="public-status-board-title" className="ui-title-section">{t("publicStatusAdmin.settingsLink.title")}</h2>
				<p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">{t("publicStatusAdmin.settingsLink.desc")}</p>
			</div>
			<ButtonLink href="/public-status" variant="outline" size="sm">{t("publicStatusAdmin.settingsLink.open")}</ButtonLink>
		</section>
	);
}
