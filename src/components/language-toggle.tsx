"use client";

import { useI18n } from "@/lib/i18n/use-locale";
import { IconLanguages } from "./nav-icons";

export function LanguageToggle({ compact = false }: { compact?: boolean }) {
	const { locale, setLocale, t } = useI18n();
	const nextLocale = locale === "zh" ? "en" : "zh";
	const label = t("languageToggle.switchLabel");

	return (
		<button
			type="button"
			onClick={() => setLocale(nextLocale)}
			className={`${compact ? "h-9 min-w-9 justify-center px-2" : "h-11 min-w-11 px-3"} flex items-center gap-1.5 rounded-md text-xs font-medium text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]`}
			aria-label={label}
			title={t("languageToggle.switchTitle")}
		>
			<IconLanguages size={16} />
			<span>{t("languageToggle.targetShort")}</span>
		</button>
	);
}
