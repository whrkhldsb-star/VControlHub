"use client";

import { useI18n } from "@/lib/i18n/use-locale";

export function LanguageToggle({ compact = false }: { compact?: boolean }) {
	const { locale, setLocale } = useI18n();
	const nextLocale = locale === "zh" ? "en" : "zh";
	const label = locale === "zh" ? "切换到英文" : "Switch to Chinese";

	return (
		<button
			type="button"
			onClick={() => setLocale(nextLocale)}
			className={`${compact ?"h-11 min-w-11 justify-center px-2" :"h-11 min-w-11 px-3"} flex items-center gap-1.5 rounded-lg text-[11px] font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]`}
			aria-label={label}
			title={locale === "zh" ? "Switch to English" : "切换到中文"}
		>
			<svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A8.966 8.966 0 013 12c0-1.264.26-2.466.732-3.558" />
			</svg>
			<span>{locale === "zh" ? "EN" : "中"}</span>
		</button>
	);
}
